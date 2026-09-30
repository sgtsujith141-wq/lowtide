import type { StoreName } from '../migrations';

/*
 * Shapes shared by the LOWTIDE app and its companion (ADR-058, ADR-059):
 * what crosses the owner API besides repository calls. Plain data only.
 */

/** Which AI client a grant is for. Informational: every client uses MCP the same way. */
export const CLIENT_KINDS = ['claude-code', 'claude', 'chatgpt', 'other'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const CLIENT_LABEL: Record<ClientKind, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  other: 'Other client',
};

/**
 * Private categories a GLOBAL grant may be given one by one. Protected time
 * is deliberately not among them: no grant can include it.
 */
export const SENSITIVE = ['routines', 'offTime', 'college', 'inbox'] as const;
export type SensitiveCategory = (typeof SENSITIVE)[number];

export const SENSITIVE_LABEL: Record<SensitiveCategory, string> = {
  routines: 'Routines (habit logs, weekly counts)',
  offTime: 'Off time (marked windows, no detail)',
  college: 'College (upcoming items)',
  inbox: 'Inbox (unprocessed thoughts)',
};

export type GrantScope = 'project' | 'workspace' | 'global';

export interface Grant {
  id: string;
  label: string;
  clientKind: ClientKind;
  scope: GrantScope;
  projectId?: string;
  access: 'read' | 'write';
  /** Resolving approvals is the owner's call unless explicitly delegated. */
  allowResolveApprovals: boolean;
  sensitive: SensitiveCategory[];
  createdAt: string;
  revokedAt?: string;
}

export interface NewGrant {
  label: string;
  clientKind: ClientKind;
  scope: GrantScope;
  projectId?: string;
  access: Grant['access'];
  allowResolveApprovals?: boolean;
  sensitive?: SensitiveCategory[];
}

export interface AuditEntry {
  id: string;
  at: string;
  grantId: string;
  client: string;
  clientKind: string;
  scope: string;
  sessionId?: string;
  requestId?: string;
  operation: string;
  entityType?: string;
  entityId?: string;
  before?: string;
  after?: string;
  result: 'ok' | 'refused' | 'error';
  message?: string;
}

export interface ClientStatus {
  kind: ClientKind;
  /** Heard from (real MCP traffic) within the last two minutes. */
  connected: boolean;
  lastSeenAt?: string;
  clientName?: string;
  grants: { id: string; label: string; scope: GrantScope; access: Grant['access'] }[];
}

export interface MigrationCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface MigrationReport {
  ok: boolean;
  problem?: string;
  exportedAt?: string;
  sourceSchemaVersion?: number;
  migratedAt?: string;
  savedCopy?: string;
  stores: { store: StoreName; backup: number; companion: number }[];
  checks: MigrationCheck[];
}

export interface CompanionStatus {
  app: 'lowtide-companion';
  version: string;
  schemaVersion: number;
  empty: boolean;
  migration: { migratedAt: string; exportedAt?: string; sourceSchemaVersion: number } | null;
  counts: Record<StoreName, number>;
  dataDir: string;
  database: string;
  workspaceDir: string;
  /** Absolute path of the stdio bridge AI clients launch. */
  bridge: string;
  /** The MCP endpoint, for clients that speak HTTP directly. */
  mcpUrl: string;
  startedAt: string;
}

export interface GitStatus {
  repository: boolean;
  remotes: string[];
  changes: number;
}

export interface SyncReport {
  written: string[];
  removed: string[];
  unchanged: number;
  /** Generated paths skipped because a person's file (no marker) is there. */
  conflicts: string[];
  at: string;
}

export interface WorkspaceInfo {
  dir: string;
  git: GitStatus;
  lastSync: SyncReport | null;
}
