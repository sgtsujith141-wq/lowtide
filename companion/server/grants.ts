import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CAPABILITIES,
  CLIENT_KINDS,
  GRANT_PRESETS,
  SENSITIVE,
  legacyCapabilities,
  type AiChange,
  type AuditEntry,
  type Capability,
  type ClientKind,
  type ClientStatus,
  type Grant,
  type GrantChanges,
  type GrantPreset,
  type NewGrant,
  type SensitiveCategory,
} from '../../src/db/companion/wire';
import { newToken } from './config';

/*
 * AI access (ADR-059). Each AI client gets a grant: a scope (one project,
 * the technical workspace, or global), read or write access, and — for a
 * global grant only — explicit per-category sensitive permissions. Protected
 * time has no permission at all: nothing can grant it. The token is shown
 * once; only its SHA-256 is stored.
 */

export { CLIENT_KINDS, SENSITIVE };
export type { AuditEntry, ClientKind, ClientStatus, Grant, NewGrant, SensitiveCategory };

export interface Sighting {
  grantId: string;
  clientName?: string;
  clientVersion?: string;
  sessionId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

type Row = Record<string, unknown>;

function toGrant(row: Row): Grant {
  const access = row.access as Grant['access'];
  const allowResolveApprovals = row.allow_resolve_approvals === 1;
  const capabilities = row.capabilities
    ? (JSON.parse(row.capabilities as string) as Capability[]).filter((c) =>
        CAPABILITIES.includes(c),
      )
    : legacyCapabilities(access, allowResolveApprovals);
  return {
    id: row.id as string,
    label: row.label as string,
    clientKind: row.client_kind as ClientKind,
    scope: row.scope as Grant['scope'],
    ...(row.project_id ? { projectId: row.project_id as string } : {}),
    access,
    allowResolveApprovals: capabilities.includes('approvals.resolve'),
    sensitive: JSON.parse(row.sensitive as string) as SensitiveCategory[],
    capabilities,
    preset: (row.preset as GrantPreset | null) ?? 'custom',
    createdAt: row.created_at as string,
    ...(row.revoked_at ? { revokedAt: row.revoked_at as string } : {}),
  };
}

/** Validated capabilities, in their canonical order. */
function checkCapabilities(list: readonly string[]): Capability[] {
  const unknown = list.find((c) => !CAPABILITIES.includes(c as Capability));
  if (unknown) throw new Error(`Unknown capability ${unknown}`);
  return CAPABILITIES.filter((c) => list.includes(c));
}

function checkPreset(preset: string | undefined): GrantPreset {
  if (preset === undefined || preset === 'custom') return 'custom';
  if (!GRANT_PRESETS.includes(preset as (typeof GRANT_PRESETS)[number]))
    throw new Error('Unknown preset');
  return preset as GrantPreset;
}

/** An inverse operation: a repository call that undoes part of a change. */
export interface InverseOp {
  repo: string;
  member: string;
  args: unknown[];
}

/** What must still be true for an undo to be safe (nothing changed since). */
export interface ChangeGuard {
  store: string;
  id: string;
  /** For SPACE pages: the revision after the change. */
  revision?: number;
  /** Otherwise: `updatedAt` after the change. */
  updatedAt?: string;
  /** Or: these fields still hold what the change left in them (absent = unset). */
  fields?: Record<string, unknown>;
}

export interface NewChange {
  grantId: string;
  client: string;
  tool: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  batchId?: string;
  inverse?: InverseOp[];
  guard?: ChangeGuard;
}

export interface StoredChange extends AiChange {
  inverse?: InverseOp[];
  guard?: ChangeGuard;
}

export class Grants {
  private readonly listeners = new Set<(what: 'audit' | 'grants' | 'sightings') => void>();

  constructor(
    private readonly sql: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hears about new audit entries, grant changes and client sightings. */
  onChange(listener: (what: 'audit' | 'grants' | 'sightings') => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(what: 'audit' | 'grants' | 'sightings') {
    for (const listener of [...this.listeners]) {
      try {
        listener(what);
      } catch {
        // Listeners never affect the record itself.
      }
    }
  }

  /** Creates a grant and returns its token, which is never stored or shown again. */
  create(input: NewGrant): { grant: Grant; token: string } {
    if (!CLIENT_KINDS.includes(input.clientKind)) throw new Error('Unknown client kind');
    if (input.scope === 'project' && !input.projectId) throw new Error('Choose a project');
    const sensitive = input.scope === 'global' ? [...new Set(input.sensitive ?? [])] : [];
    if (sensitive.some((s) => !SENSITIVE.includes(s))) throw new Error('Unknown category');
    const capabilities = input.capabilities
      ? checkCapabilities(input.capabilities)
      : legacyCapabilities(
          input.access ?? 'read',
          input.access === 'write' && input.allowResolveApprovals === true,
        );
    const token = newToken();
    const grant: Grant = {
      id: randomUUID(),
      label: input.label.trim() || input.clientKind,
      clientKind: input.clientKind,
      scope: input.scope,
      ...(input.scope === 'project' && input.projectId ? { projectId: input.projectId } : {}),
      access: capabilities.some((c) => !c.endsWith('.read')) ? 'write' : 'read',
      allowResolveApprovals: capabilities.includes('approvals.resolve'),
      sensitive,
      capabilities,
      preset: checkPreset(input.preset),
      createdAt: this.now().toISOString(),
    };
    this.sql
      .prepare(
        `INSERT INTO ai_grants (id, label, client_kind, scope, project_id, access,
          allow_resolve_approvals, sensitive, token_hash, created_at, capabilities, preset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        grant.id,
        grant.label,
        grant.clientKind,
        grant.scope,
        grant.projectId ?? null,
        grant.access,
        grant.allowResolveApprovals ? 1 : 0,
        JSON.stringify(grant.sensitive),
        hash(token),
        grant.createdAt,
        JSON.stringify(grant.capabilities),
        grant.preset,
      );
    this.changed('grants');
    return { grant, token };
  }

  /** Changes what a grant may do. Its token stays the same; revoked grants can't change. */
  update(id: string, changes: GrantChanges): Grant {
    const current = this.get(id);
    if (!current || current.revokedAt) throw new Error('No such active grant');
    const scope = changes.scope ?? current.scope;
    const projectId = scope === 'project' ? (changes.projectId ?? current.projectId) : undefined;
    if (scope === 'project' && !projectId) throw new Error('Choose a project');
    const sensitive =
      scope === 'global' ? [...new Set(changes.sensitive ?? current.sensitive)] : [];
    if (sensitive.some((s) => !SENSITIVE.includes(s))) throw new Error('Unknown category');
    const capabilities = changes.capabilities
      ? checkCapabilities(changes.capabilities)
      : current.capabilities;
    const access = capabilities.some((c) => !c.endsWith('.read')) ? 'write' : 'read';
    this.sql
      .prepare(
        `UPDATE ai_grants SET label = ?, scope = ?, project_id = ?, access = ?,
           allow_resolve_approvals = ?, sensitive = ?, capabilities = ?, preset = ?
         WHERE id = ?`,
      )
      .run(
        (changes.label ?? current.label).trim() || current.label,
        scope,
        projectId ?? null,
        access,
        capabilities.includes('approvals.resolve') ? 1 : 0,
        JSON.stringify(sensitive),
        JSON.stringify(capabilities),
        changes.preset !== undefined ? checkPreset(changes.preset) : current.preset,
        id,
      );
    this.changed('grants');
    return this.get(id)!;
  }

  get(id: string): Grant | undefined {
    const row = this.sql.prepare('SELECT * FROM ai_grants WHERE id = ?').get(id) as Row | undefined;
    return row ? toGrant(row) : undefined;
  }

  /** Keeps a reviewable, possibly undoable record of one AI change. */
  recordChange(change: NewChange): AiChange {
    const id = randomUUID();
    const at = this.now().toISOString();
    this.sql
      .prepare(
        `INSERT INTO ai_changes (id, at, grant_id, client, tool, summary, entity_type, entity_id,
           batch_id, inverse, guard)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        at,
        change.grantId,
        change.client,
        change.tool,
        change.summary.slice(0, 500),
        change.entityType ?? null,
        change.entityId ?? null,
        change.batchId ?? null,
        change.inverse?.length ? JSON.stringify(change.inverse) : null,
        change.guard ? JSON.stringify(change.guard) : null,
      );
    this.changed('audit');
    return this.change(id)!;
  }

  private toChange(r: Row): StoredChange {
    return {
      id: r.id as string,
      at: r.at as string,
      grantId: r.grant_id as string,
      client: r.client as string,
      tool: r.tool as string,
      summary: r.summary as string,
      ...(r.entity_type ? { entityType: r.entity_type as string } : {}),
      ...(r.entity_id ? { entityId: r.entity_id as string } : {}),
      ...(r.batch_id ? { batchId: r.batch_id as string } : {}),
      revertible: Boolean(r.inverse) && !r.reverted_at,
      ...(r.reverted_at ? { revertedAt: r.reverted_at as string } : {}),
      ...(r.inverse ? { inverse: JSON.parse(r.inverse as string) as InverseOp[] } : {}),
      ...(r.guard ? { guard: JSON.parse(r.guard as string) as ChangeGuard } : {}),
    };
  }

  change(id: string): StoredChange | undefined {
    const row = this.sql.prepare('SELECT * FROM ai_changes WHERE id = ?').get(id) as
      Row | undefined;
    return row ? this.toChange(row) : undefined;
  }

  /** Newest first, without the undo details. */
  changes(limit = 100, since?: string): AiChange[] {
    const rows = (
      since
        ? this.sql
            .prepare('SELECT * FROM ai_changes WHERE at > ? ORDER BY at DESC, rowid DESC LIMIT ?')
            .all(since, limit)
        : this.sql
            .prepare('SELECT * FROM ai_changes ORDER BY at DESC, rowid DESC LIMIT ?')
            .all(limit)
    ) as Row[];
    return rows.map((r) => {
      const c = this.toChange(r);
      delete c.inverse;
      delete c.guard;
      return c;
    });
  }

  markReverted(id: string) {
    this.sql
      .prepare('UPDATE ai_changes SET reverted_at = ? WHERE id = ? AND reverted_at IS NULL')
      .run(this.now().toISOString(), id);
    this.changed('audit');
  }

  list(): Grant[] {
    return (this.sql.prepare('SELECT * FROM ai_grants ORDER BY created_at').all() as Row[]).map(
      toGrant,
    );
  }

  /** Revokes a grant for good; its token stops working at once. True if it was active. */
  revoke(id: string): boolean {
    const { changes } = this.sql
      .prepare('UPDATE ai_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(this.now().toISOString(), id);
    if (changes) this.changed('grants');
    return Number(changes) > 0;
  }

  /** The active grant a bearer token belongs to, compared in constant time. */
  authenticate(token: string | undefined): Grant | undefined {
    if (!token) return undefined;
    const wanted = Buffer.from(hash(token), 'hex');
    const row = this.sql
      .prepare('SELECT * FROM ai_grants WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hash(token)) as Row | undefined;
    if (!row) return undefined;
    const stored = Buffer.from(row.token_hash as string, 'hex');
    return stored.length === wanted.length && timingSafeEqual(stored, wanted)
      ? toGrant(row)
      : undefined;
  }

  audit(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
    const full: AuditEntry = { id: randomUUID(), at: this.now().toISOString(), ...entry };
    this.sql
      .prepare(
        `INSERT INTO ai_audit (id, at, grant_id, client, client_kind, scope, session_id, request_id,
          operation, entity_type, entity_id, before_summary, after_summary, result, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.at,
        full.grantId,
        full.client,
        full.clientKind,
        full.scope,
        full.sessionId ?? null,
        full.requestId ?? null,
        full.operation,
        full.entityType ?? null,
        full.entityId ?? null,
        full.before ?? null,
        full.after ?? null,
        full.result,
        full.message ?? null,
      );
    this.changed('audit');
    return full;
  }

  auditLog(limit = 100): AuditEntry[] {
    const rows = this.sql
      .prepare('SELECT * FROM ai_audit ORDER BY at DESC, rowid DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      at: r.at as string,
      grantId: r.grant_id as string,
      client: r.client as string,
      clientKind: r.client_kind as string,
      scope: r.scope as string,
      ...(r.session_id ? { sessionId: r.session_id as string } : {}),
      ...(r.request_id ? { requestId: r.request_id as string } : {}),
      operation: r.operation as string,
      ...(r.entity_type ? { entityType: r.entity_type as string } : {}),
      ...(r.entity_id ? { entityId: r.entity_id as string } : {}),
      ...(r.before_summary ? { before: r.before_summary as string } : {}),
      ...(r.after_summary ? { after: r.after_summary as string } : {}),
      result: r.result as AuditEntry['result'],
      ...(r.message ? { message: r.message as string } : {}),
    }));
  }

  /** Records that a client with this grant was just heard from. */
  sighted(
    grantId: string,
    info: { clientName?: string; clientVersion?: string; sessionId?: string },
  ) {
    const at = this.now().toISOString();
    this.sql
      .prepare(
        `INSERT INTO ai_sightings (grant_id, client_name, client_version, session_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(grant_id) DO UPDATE SET
           client_name = COALESCE(excluded.client_name, client_name),
           client_version = COALESCE(excluded.client_version, client_version),
           session_id = COALESCE(excluded.session_id, session_id),
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        grantId,
        info.clientName ?? null,
        info.clientVersion ?? null,
        info.sessionId ?? null,
        at,
        at,
      );
    this.changed('sightings');
  }

  sightings(): Sighting[] {
    return (this.sql.prepare('SELECT * FROM ai_sightings').all() as Row[]).map((r) => ({
      grantId: r.grant_id as string,
      ...(r.client_name ? { clientName: r.client_name as string } : {}),
      ...(r.client_version ? { clientVersion: r.client_version as string } : {}),
      ...(r.session_id ? { sessionId: r.session_id as string } : {}),
      firstSeenAt: r.first_seen_at as string,
      lastSeenAt: r.last_seen_at as string,
    }));
  }
}

/** A client counts as connected while it has been heard from within this window. */
export const CONNECTED_WINDOW_MS = 2 * 60_000;

/** Connection status per client kind, from real protocol traffic only. */
export function clientStatuses(grants: Grant[], sightings: Sighting[], now: Date): ClientStatus[] {
  return CLIENT_KINDS.map((kind) => {
    const mine = grants.filter((g) => g.clientKind === kind && !g.revokedAt);
    const seen = sightings
      .filter((s) => mine.some((g) => g.id === s.grantId))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
    const connected =
      seen !== undefined && now.getTime() - Date.parse(seen.lastSeenAt) <= CONNECTED_WINDOW_MS;
    return {
      kind,
      connected,
      ...(seen ? { lastSeenAt: seen.lastSeenAt } : {}),
      ...(seen?.clientName ? { clientName: seen.clientName } : {}),
      grants: mine.map((g) => ({ id: g.id, label: g.label, scope: g.scope, access: g.access })),
    };
  });
}
