import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
import type { Grant } from './grants';
import { callTool, toolsFor, type ToolServices } from './tools';

/*
 * The Model Context Protocol at /mcp (v2.3, ADR-074), on the official MCP
 * TypeScript SDK's Streamable HTTP transport with JSON responses. Each AI
 * client authenticates with its own grant token (checked by the HTTP layer
 * before anything reaches here); a session (Mcp-Session-Id) belongs to the
 * grant that opened it and gets its own SDK server, whose two handlers call
 * LOWTIDE's one tool registry. Permissions, audit and the change log stay
 * LOWTIDE's own. Stdio clients reach this same endpoint through the bridge
 * (companion/lowtide-mcp.ts), so both transports serve one registry.
 */

export const PROTOCOL_VERSIONS: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;

const SESSION_IDLE_MS = 24 * 60 * 60_000;
const SESSIONS_PER_GRANT = 16;

interface Session {
  /** Set once the SDK has accepted the initialize request. */
  id?: string;
  /** The grant as authenticated on the latest request, so permission changes apply at once. */
  grant: Grant;
  startedAt: string;
  lastSeenAt: number;
  transport?: StreamableHTTPServerTransport;
}

function describeScope(grant: Grant): string {
  if (grant.scope === 'project') return 'one project (the tools default to it)';
  if (grant.scope === 'workspace') {
    return 'every project and hackathon, and SPACE outside College and Personal';
  }
  return grant.sensitive.length
    ? `all of LOWTIDE, including the private categories ${grant.sensitive.join(', ')}`
    : 'all of LOWTIDE except private life data';
}

/** What a model is told when it connects (the MCP server instructions). */
export function instructions(grant: Grant): string {
  return [
    'LOWTIDE is the owner’s canonical personal operating system: projects, learning, hackathons, work and life, kept locally on this computer.',
    `This connection (“${grant.label}”) can reach ${describeScope(grant)}, with ${grant.access} access. get_lowtide_capabilities says exactly what it may do.`,
    'Use structured records for state: projects, tasks, milestones, decisions, blockers, waiting items, hackathons. Use SPACE for plans, documents, research, notes and knowledge; don’t put state in SPACE pages when a record fits.',
    'Search before creating (search_lowtide, search_space); create tools return an existing match instead of a duplicate.',
    'Never fabricate work sessions, completions, progress, milestones, activity or Daily Pulse history. Complete something only when the work is verified done.',
    'Protected Time is never available to AI. Respect this grant: a refusal says what was refused and which permission would allow it.',
    grant.access === 'write'
      ? 'Every change is attributed to this connection, audited and visible to the owner, who can undo it. Record decisions with record_decision and finish with document_project_session or log_ai_session: facts, never hidden reasoning.'
      : 'This connection is read-only.',
  ].join('\n');
}

export interface McpReply {
  status: number;
  body: unknown;
}

const jsonRpcError = (status: number, code: number, message: string): McpReply => ({
  status,
  body: { jsonrpc: '2.0', id: null, error: { code, message } },
});

export class McpServer {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly services: ToolServices,
    private readonly version: string,
  ) {}

  /** Live sessions of a grant (for status). */
  sessionsOf(grantId: string): number {
    return [...this.sessions.values()].filter((s) => s.grant.id === grantId).length;
  }

  /** All live sessions (for health). */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Ends every session of a revoked grant. */
  dropGrant(grantId: string) {
    for (const s of [...this.sessions.values()]) if (s.grant.id === grantId) void this.end(s);
  }

  /** Ends every session (the companion is closing). */
  async closeAll() {
    await Promise.all([...this.sessions.values()].map((s) => this.end(s)));
  }

  private end(session: Session): Promise<void> {
    if (session.id) this.sessions.delete(session.id);
    return session.transport?.close().catch(() => undefined) ?? Promise.resolve();
  }

  private prune(now: number) {
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastSeenAt > SESSION_IDLE_MS) void this.end(s);
    }
  }

  /** The SDK server for one session: tools only, both handlers calling LOWTIDE's registry. */
  private serverFor(session: Session) {
    const server = new Server(
      { name: 'lowtide', title: 'LOWTIDE', version: this.version },
      {
        capabilities: { tools: { listChanged: false } },
        instructions: instructions(session.grant),
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolsFor(session.grant) }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => ({
      ...(await callTool(
        this.services,
        {
          grant: session.grant,
          ...(session.id ? { sessionId: session.id } : {}),
          requestId: String(extra.requestId),
          sessionStartedAt: session.startedAt,
        },
        request.params.name,
        request.params.arguments,
      )),
    }));
    server.oninitialized = () => {
      const info = server.getClientVersion();
      this.services.grants.sighted(session.grant.id, {
        ...(typeof info?.name === 'string' ? { clientName: info.name.slice(0, 100) } : {}),
        ...(typeof info?.version === 'string' ? { clientVersion: info.version.slice(0, 50) } : {}),
        ...(session.id ? { sessionId: session.id } : {}),
      });
    };
    return server;
  }

  /**
   * One HTTP request to /mcp from an authenticated grant (POST, GET or
   * DELETE); `body` is a POST's parsed JSON. Returns a reply to send when
   * LOWTIDE answers itself; undefined when the SDK transport has answered.
   */
  async handle(
    grant: Grant,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<McpReply | undefined> {
    const now = this.services.now().getTime();
    this.prune(now);
    const sessionId = req.headers['mcp-session-id'];

    if (typeof sessionId === 'string') {
      const session = this.sessions.get(sessionId);
      if (!session?.transport || session.grant.id !== grant.id) {
        return jsonRpcError(404, -32001, 'Session not found: initialize again');
      }
      session.grant = grant;
      session.lastSeenAt = now;
      this.services.grants.sighted(grant.id, { sessionId });
      await session.transport.handleRequest(req, res, body);
      return undefined;
    }

    const opening =
      req.method === 'POST' &&
      (isInitializeRequest(body) || (Array.isArray(body) && body.some(isInitializeRequest)));
    if (!opening) return jsonRpcError(400, -32000, 'Missing Mcp-Session-Id: initialize first');

    const mine = [...this.sessions.values()]
      .filter((s) => s.grant.id === grant.id)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    while (mine.length >= SESSIONS_PER_GRANT) void this.end(mine.shift()!);

    const session: Session = { grant, startedAt: new Date(now).toISOString(), lastSeenAt: now };
    const server = this.serverFor(session);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        session.id = id;
        this.sessions.set(id, session);
      },
    });
    session.transport = transport;
    transport.onclose = () => {
      if (session.id && this.sessions.get(session.id) === session) this.sessions.delete(session.id);
    };
    // The SDK's own transport class, typed without exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, body);
    return undefined;
  }
}
