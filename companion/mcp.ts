import { callTool, TOOLS } from './tools.ts';
import type { Workspace } from './workspace.ts';

/*
 * A minimal Model Context Protocol server over stdio (JSON-RPC 2.0, one
 * message per line). No network: the AI client starts this process and talks
 * to it through standard input and output only.
 */

export const SERVER_INFO = { name: 'lowtide', version: '0.1.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Json = Record<string, unknown>;

export function handleMessage(ws: Workspace, message: Json): Json | null {
  const id = message.id as string | number | undefined;
  const method = message.method;
  const reply = (result: Json) => ({ jsonrpc: '2.0', id, result });
  const error = (code: number, text: string) => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message: text },
  });

  if (message.jsonrpc !== '2.0' || typeof method !== 'string') {
    return error(-32600, 'Invalid request');
  }
  // Notifications (no id) get no response.
  if (id === undefined) return null;

  switch (method) {
    case 'initialize': {
      const asked = (message.params as Json | undefined)?.protocolVersion;
      return reply({
        protocolVersion:
          typeof asked === 'string' && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          ws.scope.kind === 'project'
            ? `LOWTIDE workspace, scoped to project "${ws.scope.slug}". Start with get_context.`
            : 'LOWTIDE workspace (all projects, technical knowledge only). Start with get_context for a project.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case 'tools/call': {
      const params = (message.params ?? {}) as Json;
      if (typeof params.name !== 'string') return error(-32602, 'Missing tool name');
      const args = (params.arguments ?? {}) as Json;
      return reply(callTool(ws, params.name, args) as unknown as Json);
    }
    default:
      return error(-32601, `Method not found: ${method}`);
  }
}

/** Reads newline-delimited JSON-RPC from `input`, writes responses to `output`. */
export function serve(
  ws: Workspace,
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): unknown },
) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: Json;
      try {
        message = JSON.parse(line) as Json;
      } catch {
        output.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
        );
        continue;
      }
      const response = handleMessage(ws, message);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  });
}
