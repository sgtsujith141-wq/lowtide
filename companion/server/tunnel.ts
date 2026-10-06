import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/*
 * The ChatGPT connection (v2.3): ChatGPT reaches MCP servers over the
 * internet, and LOWTIDE listens only on 127.0.0.1, so a ChatGPT connection
 * needs a secure, authenticated tunnel the owner sets up (docs/integrations/
 * CHATGPT-MCP.md). LOWTIDE never opens one by itself and never binds beyond
 * this computer. This reports which supported tunnel clients are installed;
 * LOWTIDE doesn't manage a tunnel yet, so the connection is "not configured".
 */

const CLIENTS = [
  { name: 'cloudflared', files: ['cloudflared'] },
  { name: 'ngrok', files: ['ngrok'] },
  { name: 'tailscale', files: ['tailscale', '/Applications/Tailscale.app'] },
] as const;

export interface TunnelStatus {
  status: 'not-configured';
  /** Supported tunnel clients found on this computer. */
  clientsInstalled: string[];
  docs: string;
}

export async function tunnelStatus(
  env: { path?: string; exists?: (p: string) => boolean } = {},
): Promise<TunnelStatus> {
  const exists = env.exists ?? existsSync;
  const dirs = [
    ...(env.path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const clientsInstalled = CLIENTS.filter((c) =>
    c.files.some((f) => (f.startsWith('/') ? exists(f) : dirs.some((d) => exists(join(d, f))))),
  ).map((c) => c.name);
  return {
    status: 'not-configured',
    clientsInstalled,
    docs: 'docs/integrations/CHATGPT-MCP.md',
  };
}
