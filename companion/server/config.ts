import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * The companion's data directory (ADR-058), private to the owner:
 *
 *   <data>/companion.json   port, allowed origins, workspace path, owner token (0600)
 *   <data>/lowtide.sqlite   the canonical database once migrated (0600)
 *   <data>/backups/         exact copies of migration payloads (0600)
 *   <workspace>/            the technical workspace (default <data>/workspace)
 *
 * The owner token pairs the LOWTIDE app with the companion. AI clients never
 * use it: each gets its own scoped grant token.
 */

export interface CompanionConfig {
  port: number;
  allowedOrigins: string[];
  workspaceDir: string;
  ownerToken: string;
}

export const DEFAULT_PORT = 4318;

export const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

export function defaultDataDir(): string {
  return process.env.LOWTIDE_DATA_DIR || join(homedir(), '.lowtide');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/**
 * Loads the stored config, creating it (with a fresh owner token) on first
 * run. The directory and file stay owner-only. Per-run overrides (flags,
 * tests) are applied by the caller and never written back.
 */
export function loadConfig(dataDir: string): CompanionConfig {
  ensurePrivateDir(dataDir);
  ensurePrivateDir(join(dataDir, 'backups'));
  const file = join(dataDir, 'companion.json');
  if (existsSync(file)) {
    chmodSync(file, 0o600);
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<CompanionConfig>;
    if (typeof stored.ownerToken !== 'string' || stored.ownerToken.length < 32) {
      throw new Error(`${file} has no valid owner token`);
    }
    return {
      port: stored.port ?? DEFAULT_PORT,
      allowedOrigins: stored.allowedOrigins ?? DEFAULT_ORIGINS,
      workspaceDir: stored.workspaceDir ?? join(dataDir, 'workspace'),
      ownerToken: stored.ownerToken,
    };
  }
  const config: CompanionConfig = {
    port: DEFAULT_PORT,
    allowedOrigins: DEFAULT_ORIGINS,
    workspaceDir: join(dataDir, 'workspace'),
    ownerToken: newToken(),
  };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return config;
}

/** A new owner token, written back (the app must be paired again). */
export function rotateOwnerToken(dataDir: string): CompanionConfig {
  const file = join(dataDir, 'companion.json');
  const config = { ...loadConfig(dataDir), ownerToken: newToken() };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return config;
}
