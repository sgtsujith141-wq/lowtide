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
export const SENSITIVE = ['routines', 'offTime', 'college', 'inbox', 'personalSpace'] as const;
export type SensitiveCategory = (typeof SENSITIVE)[number];

export const SENSITIVE_LABEL: Record<SensitiveCategory, string> = {
  routines: 'Routines (habit logs, weekly counts)',
  offTime: 'Off time (marked windows, no detail)',
  college: 'College (upcoming items)',
  inbox: 'Inbox (unprocessed thoughts)',
  personalSpace: 'Personal SPACE (pages under Personal)',
};

export type GrantScope = 'project' | 'workspace' | 'global';

/**
 * What an AI client may do (v2.1), one capability at a time. Scope still
 * decides *where* (one project, the workspace, everything), and the private
 * categories above still gate private life data. Protected time, tokens and
 * permanent deletion are not capabilities at all: no grant can include them.
 */
export const CAPABILITIES = [
  'projects.read',
  'projects.create',
  'projects.edit',
  'projects.archive',
  'tasks.read',
  'tasks.create',
  'tasks.edit',
  'tasks.complete',
  'milestones.edit',
  'items.edit',
  'approvals.resolve',
  'decisions.read',
  'decisions.write',
  'hackathons.read',
  'hackathons.write',
  'space.read',
  'space.write',
  'space.structure',
  'space.archive',
  'sessions.log',
  'life.write',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABEL: Record<Capability, string> = {
  'projects.read': 'Read projects',
  'projects.create': 'Create projects',
  'projects.edit': 'Edit projects (details, state, focus, pins)',
  'projects.archive': 'Archive and restore projects',
  'tasks.read': 'Read tasks',
  'tasks.create': 'Create tasks',
  'tasks.edit': 'Edit, move and archive tasks',
  'tasks.complete': 'Complete and reopen tasks',
  'milestones.edit': 'Create, edit, reorder, complete and archive milestones',
  'items.edit': 'Blockers, waiting, parked ideas and approval requests',
  'approvals.resolve': 'Resolve approval requests',
  'decisions.read': 'Read decisions',
  'decisions.write': 'Record and supersede decisions',
  'hackathons.read': 'Read hackathons',
  'hackathons.write': 'Create, edit and archive hackathons',
  'space.read': 'Read SPACE',
  'space.write': 'Write SPACE pages and databases',
  'space.structure': 'Create folders, move, rename, duplicate, pin',
  'space.archive': 'Archive and restore in SPACE',
  'sessions.log': 'Log AI sessions, notes and checkpoints',
  'life.write': 'Write routines, college and inbox (only the private categories granted)',
};

/** Groups for showing capabilities: what each area allows. */
export const CAPABILITY_GROUPS: { title: string; capabilities: Capability[] }[] = [
  {
    title: 'Projects',
    capabilities: ['projects.read', 'projects.create', 'projects.edit', 'projects.archive'],
  },
  { title: 'Tasks', capabilities: ['tasks.read', 'tasks.create', 'tasks.edit', 'tasks.complete'] },
  { title: 'Roadmap', capabilities: ['milestones.edit', 'items.edit', 'approvals.resolve'] },
  { title: 'Decisions', capabilities: ['decisions.read', 'decisions.write'] },
  { title: 'Hackathons', capabilities: ['hackathons.read', 'hackathons.write'] },
  {
    title: 'SPACE',
    capabilities: ['space.read', 'space.write', 'space.structure', 'space.archive'],
  },
  { title: 'Sessions and life', capabilities: ['sessions.log', 'life.write'] },
];

const READS: Capability[] = CAPABILITIES.filter((c) => c.endsWith('.read'));
const ALL_BUT = (...skip: Capability[]) => CAPABILITIES.filter((c) => !skip.includes(c));

/** The access presets the AI area offers; Custom is any other set. */
export const GRANT_PRESETS = ['read', 'project', 'workspace', 'full'] as const;
export type GrantPreset = (typeof GRANT_PRESETS)[number] | 'custom';

export const PRESET: Record<
  (typeof GRANT_PRESETS)[number],
  {
    label: string;
    description: string;
    scope: GrantScope;
    capabilities: Capability[];
    sensitive: SensitiveCategory[];
  }
> = {
  read: {
    label: 'Read only',
    description: 'Reads projects, tasks, decisions, hackathons and SPACE. Changes nothing.',
    scope: 'workspace',
    capabilities: READS,
    sensitive: [],
  },
  project: {
    label: 'Project operator',
    description:
      'Runs one project: its tasks, roadmap, decisions, blockers and SPACE folder. Can’t create or archive projects.',
    scope: 'project',
    capabilities: ALL_BUT('projects.create', 'projects.archive', 'approvals.resolve', 'life.write'),
    sensitive: [],
  },
  workspace: {
    label: 'Workspace operator',
    description:
      'Every project and hackathon, and SPACE outside College and Personal. Creates and archives projects. No private life data.',
    scope: 'workspace',
    capabilities: ALL_BUT('approvals.resolve', 'life.write'),
    sensitive: [],
  },
  full: {
    label: 'Full LOWTIDE operator',
    description:
      'Everything you can do in LOWTIDE, including your routines, college, inbox, off time and Personal SPACE — except Protected Time, tokens and permanent deletion.',
    scope: 'global',
    capabilities: [...CAPABILITIES],
    sensitive: [...SENSITIVE],
  },
};

export interface Grant {
  id: string;
  label: string;
  clientKind: ClientKind;
  scope: GrantScope;
  projectId?: string;
  /** `write` when any capability changes something (kept for older clients of this API). */
  access: 'read' | 'write';
  /** Resolving approvals is the owner's call unless explicitly delegated. */
  allowResolveApprovals: boolean;
  sensitive: SensitiveCategory[];
  /** What this grant may do (v2.1). Grants made earlier get theirs from `access`. */
  capabilities: Capability[];
  /** The preset it was made from, or `custom`. */
  preset: GrantPreset;
  createdAt: string;
  revokedAt?: string;
}

export interface NewGrant {
  label: string;
  clientKind: ClientKind;
  scope: GrantScope;
  projectId?: string;
  /** Older callers: read or write. Ignored when `capabilities` is given. */
  access?: Grant['access'];
  allowResolveApprovals?: boolean;
  sensitive?: SensitiveCategory[];
  capabilities?: Capability[];
  preset?: GrantPreset;
}

/** Edits to a grant's access; its token stays the same. */
export interface GrantChanges {
  label?: string;
  scope?: GrantScope;
  projectId?: string;
  sensitive?: SensitiveCategory[];
  capabilities?: Capability[];
  preset?: GrantPreset;
}

/**
 * Capabilities a grant made before v2.1 had, by its access: read-only reads;
 * "read and make changes" operates the workspace (approvals only if delegated).
 */
export function legacyCapabilities(
  access: Grant['access'],
  allowResolveApprovals: boolean,
): Capability[] {
  if (access === 'read') return READS;
  return ALL_BUT('life.write', ...(allowResolveApprovals ? [] : ['approvals.resolve' as const]));
}

/** One AI change as the owner reviews it, with what undoing it would do. */
export interface AiChange {
  id: string;
  at: string;
  grantId: string;
  client: string;
  tool: string;
  /** "Created project Media Engine", "Moved PDF Engine to Engineering"… */
  summary: string;
  entityType?: string;
  entityId?: string;
  /** Same id for every change one bulk call made. */
  batchId?: string;
  /** True when LOWTIDE can put it back as it was. */
  revertible: boolean;
  revertedAt?: string;
}

/** A named copy of the whole database, taken before something big. */
export interface Checkpoint {
  id: string;
  name: string;
  at: string;
  by: string;
  bytes: number;
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
  /** Where the companion serves the LOWTIDE app itself (v2.3); null when it serves none. */
  appUrl?: string | null;
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
