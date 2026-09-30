import { randomUUID } from 'node:crypto';
import type { Grant } from './grants';
import { callTool, toolsFor, type ToolServices } from './tools';

/*
 * The Model Context Protocol over HTTP (the "Streamable HTTP" transport,
 * JSON responses only) at /mcp. Each AI client authenticates with its own
 * grant token; a session (Mcp-Session-Id) belongs to the grant that opened
 * it. The server offers tools only: no resources, prompts or sampling, and
 * it never sends requests of its own. Stdio clients reach it through the
 * bridge (companion/lowtide-mcp.ts).
 */

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const LATEST = PROTOCOL_VERSIONS[0];

const SESSION_IDLE_MS = 24 * 60 * 60_000;
const SESSIONS_PER_GRANT = 16;

interface Session {
  id: string;
  grantId: string;
  protocolVersion: string;
  clientName?: string;
  clientVersion?: string;
  startedAt: string;
  lastSeenAt: number;
}

type JsonRpcId = string | number;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface McpReply {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

const rpcError = (id: JsonRpcId | null, code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message },
});

function describeScope(grant: Grant): string {
  if (grant.scope === 'project') return 'one project (the tools default to it)';
  if (grant.scope === 'workspace') return 'every technical project and hackathon';
  const extra = grant.sensitive.length ? `, plus ${grant.sensitive.join(', ')}` : '';
  return `the whole technical workspace and non-project tasks${extra}`;
}

function instructions(grant: Grant): string {
  return [
    'LOWTIDE is its owner’s private, local-first operating system for projects, work and rhythm.',
    `This connection (“${grant.label}”) can see ${describeScope(grant)}, with ${grant.access} access.`,
    'Start with get_context. Project ids and slugs both work wherever a project is asked for.',
    grant.access === 'write'
      ? 'Every change you make is attributed to you, audited, and visible to the owner. Record decisions with record_decision and finish with log_ai_session: a factual summary of what you did, never hidden reasoning.'
      : 'This connection is read-only.',
    'PROJECT.md and CONTEXT.md in the workspace are generated from LOWTIDE and rewritten on every change; write notes with create_note instead.',
    'Protected time and private life logs are never available here.',
  ].join('\n');
}

export class McpServer {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly services: ToolServices,
    private readonly version: string,
  ) {}

  /** Live sessions of a grant (for status). */
  sessionsOf(grantId: string): number {
    return [...this.sessions.values()].filter((s) => s.grantId === grantId).length;
  }

  /** Ends every session of a revoked grant. */
  dropGrant(grantId: string) {
    for (const [id, s] of this.sessions) if (s.grantId === grantId) this.sessions.delete(id);
  }

  private prune(now: number) {
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeenAt > SESSION_IDLE_MS) this.sessions.delete(id);
    }
  }

  async post(
    grant: Grant,
    headers: { sessionId?: string; protocolVersion?: string },
    body: unknown,
  ): Promise<McpReply> {
    const now = this.services.now();
    this.prune(now.getTime());
    if (Array.isArray(body)) {
      return { status: 400, body: rpcError(null, -32600, 'Batched messages aren’t supported') };
    }
    if (!body || typeof body !== 'object' || (body as JsonRpcMessage).jsonrpc !== '2.0') {
      return { status: 400, body: rpcError(null, -32600, 'Expected one JSON-RPC 2.0 message') };
    }
    const message = body as JsonRpcMessage;
    if (
      message.id !== undefined &&
      message.id !== null &&
      !['string', 'number'].includes(typeof message.id)
    ) {
      return { status: 400, body: rpcError(null, -32600, 'A JSON-RPC id is a string or a number') };
    }
    const id = message.id ?? null;
    const isRequest = typeof message.method === 'string' && id !== null;

    // Responses to server requests (it sends none) and stray results: accept and ignore.
    if (typeof message.method !== 'string') return { status: 202 };

    if (message.method === 'initialize') {
      if (!isRequest)
        return { status: 400, body: rpcError(null, -32600, 'initialize needs an id') };
      const params = (message.params ?? {}) as {
        protocolVersion?: string;
        clientInfo?: { name?: string; version?: string };
      };
      const requested = params.protocolVersion;
      const protocolVersion =
        requested && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : LATEST;
      const mine = [...this.sessions.values()]
        .filter((s) => s.grantId === grant.id)
        .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      while (mine.length >= SESSIONS_PER_GRANT) this.sessions.delete(mine.shift()!.id);
      const session: Session = {
        id: randomUUID(),
        grantId: grant.id,
        protocolVersion,
        ...(typeof params.clientInfo?.name === 'string'
          ? { clientName: params.clientInfo.name.slice(0, 100) }
          : {}),
        ...(typeof params.clientInfo?.version === 'string'
          ? { clientVersion: params.clientInfo.version.slice(0, 50) }
          : {}),
        startedAt: now.toISOString(),
        lastSeenAt: now.getTime(),
      };
      this.sessions.set(session.id, session);
      this.services.grants.sighted(grant.id, {
        ...(session.clientName ? { clientName: session.clientName } : {}),
        ...(session.clientVersion ? { clientVersion: session.clientVersion } : {}),
        sessionId: session.id,
      });
      return {
        status: 200,
        headers: { 'mcp-session-id': session.id },
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'lowtide', title: 'LOWTIDE', version: this.version },
            instructions: instructions(grant),
          },
        },
      };
    }

    const session = headers.sessionId ? this.sessions.get(headers.sessionId) : undefined;
    if (!headers.sessionId) {
      return {
        status: 400,
        body: rpcError(id, -32000, 'Missing Mcp-Session-Id: initialize first'),
      };
    }
    if (!session || session.grantId !== grant.id) {
      return { status: 404, body: rpcError(id, -32001, 'Session not found: initialize again') };
    }
    if (
      headers.protocolVersion !== undefined &&
      !(PROTOCOL_VERSIONS as readonly string[]).includes(headers.protocolVersion)
    ) {
      return { status: 400, body: rpcError(id, -32000, 'Unsupported MCP-Protocol-Version') };
    }
    session.lastSeenAt = now.getTime();
    this.services.grants.sighted(grant.id, { sessionId: session.id });

    if (!isRequest) return { status: 202 }; // notifications: initialized, cancelled, …

    switch (message.method) {
      case 'ping':
        return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };
      case 'tools/list':
        return {
          status: 200,
          body: { jsonrpc: '2.0', id, result: { tools: toolsFor(grant) } },
        };
      case 'tools/call': {
        const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof params.name !== 'string') {
          return { status: 200, body: rpcError(id, -32602, 'tools/call needs a tool name') };
        }
        const result = await callTool(
          this.services,
          {
            grant,
            sessionId: session.id,
            requestId: String(id),
            sessionStartedAt: session.startedAt,
          },
          params.name,
          params.arguments,
        );
        return { status: 200, body: { jsonrpc: '2.0', id, result } };
      }
      default:
        return { status: 200, body: rpcError(id, -32601, `Method not found: ${message.method}`) };
    }
  }

  /** Client-initiated session end (DELETE /mcp). */
  delete(grant: Grant, sessionId: string | undefined): McpReply {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session || session.grantId !== grant.id) return { status: 404 };
    this.sessions.delete(session.id);
    return { status: 204 };
  }
}
