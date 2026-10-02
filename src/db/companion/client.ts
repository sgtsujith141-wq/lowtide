import { inspectBackup } from '../backup';
import {
  InvalidInputError,
  RecordNotFoundError,
  RecordStateError,
  type Repositories,
  type ValidatedBackup,
  type Watch,
} from '../repositories';
import { REPOSITORY_CONTRACT, type RepoName, type RpcResponse, type WireError } from './contract';
import type {
  AiChange,
  AuditEntry,
  Checkpoint,
  ClientStatus,
  GrantChanges,
  CompanionStatus,
  GitStatus,
  Grant,
  MigrationReport,
  NewGrant,
  WorkspaceInfo,
} from './wire';

/*
 * The app's side of the companion (ADR-058, stage C): repositories with
 * exactly the contract the screens already use, answered by the companion
 * over HTTP on this machine. Live queries ask again when the companion's
 * event stream says something changed, whoever changed it: the owner here
 * or in another tab, or an AI client through MCP. No polling.
 *
 * There is deliberately no fallback to IndexedDB while in companion mode:
 * two canonical stores would drift apart. If the companion can't be
 * reached, reads and writes fail calmly and the app says so.
 */

export interface CompanionConnection {
  /** e.g. http://127.0.0.1:4318 */
  url: string;
  /** The owner token (from `npm run companion -- pair`). */
  token: string;
}

export type StreamState = 'connecting' | 'open' | 'retrying' | 'stopped';

export type CompanionEvent =
  | { type: 'change'; stores: string[] }
  | { type: 'ai'; what: 'audit' | 'grants' | 'sightings' }
  | { type: 'workspace'; at: string; written: number; removed: number; conflicts: string[] };

export interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  restartOnFailure: boolean;
  managed: boolean;
  agentPath: string;
}

/** What /api/health/details reports. */
export interface CompanionHealth {
  companion: { running: boolean; version: string; startedAt: string; pid: number };
  database: { healthy: boolean; detail: string; path: string; schemaVersion: number };
  mcp: { available: boolean; url: string; bridge: string };
  workspace: { healthy: boolean; dir: string; lastSync: string | null; conflicts: string[] };
  autostart: AutostartStatus;
  restart: boolean;
}

export class CompanionUnavailableError extends Error {
  constructor(url: string) {
    super(`The LOWTIDE companion isn’t reachable at ${url}`);
    this.name = 'CompanionUnavailableError';
  }
}

export class CompanionAuthError extends Error {
  constructor() {
    super('The companion didn’t accept this pairing. Pair LOWTIDE with it again.');
    this.name = 'CompanionAuthError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function fromWire(error: WireError): Error {
  switch (error.name) {
    case 'RecordNotFoundError': {
      const e = new RecordNotFoundError('', '');
      e.message = error.message;
      return e;
    }
    case 'RecordStateError':
      return new RecordStateError(error.message);
    case 'InvalidInputError':
      return new InvalidInputError(error.message);
    default: {
      const e = new Error(error.message);
      e.name = error.name;
      return e;
    }
  }
}

/** JSON turns a missing positional argument into null; drop trailing ones instead. */
function trimArgs(args: unknown[]): unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end -= 1;
  return args.slice(0, end);
}

const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
const INVALIDATE_DEBOUNCE_MS = 30;

export class CompanionClient {
  readonly url: string;
  private readonly token: string;
  private readonly fetch: Fetch;
  private readonly invalidators = new Set<() => void>();
  private readonly eventListeners = new Set<(event: CompanionEvent) => void>();
  private readonly stateListeners = new Set<(state: StreamState) => void>();
  private currentState: StreamState = 'stopped';
  private abort: AbortController | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;

  constructor(connection: CompanionConnection, fetchImpl?: Fetch) {
    this.url = connection.url.replace(/\/$/, '');
    this.token = connection.token;
    this.fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get state(): StreamState {
    return this.currentState;
  }

  onState(listener: (state: StreamState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: (event: CompanionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private setState(state: StreamState) {
    if (state === this.currentState) return;
    this.currentState = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(`${this.url}${path}`, {
        ...init,
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new CompanionUnavailableError(this.url);
    }
    if (response.status === 401) throw new CompanionAuthError();
    const body = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      const message = (body as { error?: string } | undefined)?.error;
      throw new Error(message ?? `The companion answered ${response.status}`);
    }
    return body as T;
  }

  /** Is a companion listening at this address? (No token needed.) */
  static async probe(url: string, fetchImpl?: Fetch): Promise<boolean> {
    const f = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
    try {
      const response = await f(`${url.replace(/\/$/, '')}/api/health`, { cache: 'no-store' });
      const body = (await response.json()) as { app?: string };
      return response.ok && body.app === 'lowtide-companion';
    } catch {
      return false;
    }
  }

  async rpc(repo: RepoName, member: string, args: unknown[]): Promise<unknown> {
    const reply = await this.request<RpcResponse>('/api/rpc', {
      method: 'POST',
      body: JSON.stringify({ repo, member, args: trimArgs(args) }),
    });
    if (!reply.ok) throw fromWire(reply.error);
    return reply.value ?? undefined;
  }

  status() {
    return this.request<CompanionStatus>('/api/status');
  }

  /** Sends a backup file's text; the companion validates and verifies everything itself. */
  migrate(backupText: string) {
    return this.request<MigrationReport>('/api/migrate', { method: 'POST', body: backupText });
  }

  grants() {
    return this.request<Grant[]>('/api/ai/grants');
  }

  /** The token comes back once and is never retrievable again. */
  createGrant(input: NewGrant) {
    return this.request<{ grant: Grant; token: string }>('/api/ai/grants', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  revokeGrant(id: string) {
    return this.request<{ revoked: boolean }>(`/api/ai/grants/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: '{}',
    });
  }

  audit(limit = 100) {
    return this.request<AuditEntry[]>(`/api/ai/audit?limit=${limit}`);
  }

  clients() {
    return this.request<ClientStatus[]>('/api/ai/clients');
  }

  /** Changes what a grant may do; its token stays the same. */
  updateGrant(id: string, changes: GrantChanges) {
    return this.request<Grant>(`/api/ai/grants/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(changes),
    });
  }

  /** AI changes, newest first (optionally only those after `since`). */
  changes(limit = 100, since?: string) {
    return this.request<AiChange[]>(
      `/api/ai/changes?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
    );
  }

  /** Undoes one change; rejects with the companion's reason when it can't. */
  revertChange(id: string) {
    return this.request<AiChange[]>(`/api/ai/changes/${encodeURIComponent(id)}/revert`, {
      method: 'POST',
      body: '{}',
    });
  }

  revertBatch(batchId: string) {
    return this.request<AiChange[]>(`/api/ai/changes/batch/${encodeURIComponent(batchId)}/revert`, {
      method: 'POST',
      body: '{}',
    });
  }

  checkpoints() {
    return this.request<Checkpoint[]>('/api/checkpoints');
  }

  createCheckpoint(name: string) {
    return this.request<Checkpoint>('/api/checkpoints', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  restoreCheckpoint(id: string) {
    return this.request<{ restored: Checkpoint }>(
      `/api/checkpoints/${encodeURIComponent(id)}/restore`,
      { method: 'POST', body: '{}' },
    );
  }

  removeCheckpoint(id: string) {
    return this.request<{ removed: boolean }>(`/api/checkpoints/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      body: '{}',
    });
  }

  health() {
    return this.request<CompanionHealth>('/api/health/details');
  }

  logs(lines = 200) {
    return this.request<{ file: string; lines: string[] }>(`/api/system/logs?lines=${lines}`);
  }

  setAutostart(enabled: boolean, restartOnFailure: boolean) {
    return this.request<AutostartStatus>('/api/system/autostart', {
      method: 'POST',
      body: JSON.stringify({ enabled, restartOnFailure }),
    });
  }

  restart() {
    return this.request<{ restarting: boolean }>('/api/system/restart', {
      method: 'POST',
      body: '{}',
    });
  }

  workspace() {
    return this.request<WorkspaceInfo>('/api/workspace');
  }

  gitInit() {
    return this.request<GitStatus>('/api/workspace/git-init', { method: 'POST', body: '{}' });
  }

  /* ----------------------------- live data ----------------------------- */

  /** Opens the event stream (idempotent). */
  start() {
    if (this.currentState !== 'stopped') return;
    this.setState('connecting');
    void this.connect();
  }

  stop() {
    this.setState('stopped');
    this.abort?.abort();
    if (this.retry) clearTimeout(this.retry);
    if (this.debounce) clearTimeout(this.debounce);
  }

  private async connect() {
    const controller = new AbortController();
    this.abort = controller;
    try {
      const response = await this.fetch(`${this.url}/api/events`, {
        headers: { authorization: `Bearer ${this.token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
      this.attempts = 0;
      this.setState('open');
      this.invalidate(); // catch up on anything missed while disconnected
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          this.frame(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch {
      // Reconnect below.
    }
    if (this.currentState === 'stopped' || controller.signal.aborted) return;
    this.setState('retrying');
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)]!;
    this.attempts += 1;
    this.retry = setTimeout(() => void this.connect(), delay);
  }

  private frame(frame: string) {
    let event = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'change') this.invalidate();
    if (event === 'change' || event === 'ai' || event === 'workspace') {
      const message = { type: event, ...payload } as CompanionEvent;
      for (const listener of [...this.eventListeners]) listener(message);
    }
  }

  private invalidate() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      for (const invalidate of [...this.invalidators]) invalidate();
    }, INVALIDATE_DEBOUNCE_MS);
  }

  /** A live query answered by the companion: asked now, and again after every change. */
  live<T>(query: () => Promise<T>): Watch<T> {
    return (onChange, onError) => {
      let stopped = false;
      let running = false;
      let again = false;
      let first = true;
      let last: string | undefined;
      const run = async () => {
        if (running) {
          again = true;
          return;
        }
        running = true;
        try {
          do {
            again = false;
            const value = await query();
            if (stopped) return;
            const key = JSON.stringify(value);
            if (first || key !== last) {
              first = false;
              last = key;
              onChange(value);
            }
          } while (again && !stopped);
        } catch (error) {
          if (!stopped) onError?.(error);
        } finally {
          running = false;
        }
      };
      this.invalidators.add(run);
      this.start();
      void run();
      return () => {
        stopped = true;
        this.invalidators.delete(run);
      };
    };
  }
}

/** Repositories backed by the companion, member for member (see the contract). */
export function createCompanionRepositories(client: CompanionClient): Repositories {
  const local: Record<string, Record<string, unknown>> = { backup: { inspect: inspectBackup } };
  const repositories: Record<string, Record<string, unknown>> = {};
  for (const [repo, members] of Object.entries(REPOSITORY_CONTRACT)) {
    const target: Record<string, unknown> = {};
    for (const [member, kind] of Object.entries(members)) {
      const call = (args: unknown[]) => client.rpc(repo as RepoName, member, args);
      if (kind === 'call') target[member] = (...args: unknown[]) => call(args);
      else if (kind === 'watch') target[member] = client.live(() => call([]));
      else if (kind === 'watchFactory') {
        target[member] = (...args: unknown[]) => client.live(() => call(args));
      } else target[member] = local[repo]?.[member];
    }
    repositories[repo] = target;
  }
  // A validated backup can't cross the wire as such: send its content, which
  // the companion validates again before replacing anything.
  repositories.backup!.restore = (backup: ValidatedBackup) =>
    client.rpc('backup', 'restore', [{ exportedAt: backup.exportedAt, data: backup.data }]);
  return repositories as unknown as Repositories;
}
