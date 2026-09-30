import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from '../../src/db/backup';
import {
  REPOSITORY_CONTRACT,
  type RpcRequest,
  type WireError,
} from '../../src/db/companion/contract';
import { InvalidInputError, SCHEMA_VERSION, type Repositories } from '../../src/db/repositories';
import type { BackupData, Watch } from '../../src/db/repositories';

/*
 * The owner's repository RPC (ADR-058). The LOWTIDE app, paired with the
 * owner token, calls the same repository members it would call on Dexie;
 * this dispatches them by the shared contract, so nothing outside it can be
 * reached. Live members answer once with their current value; the app
 * re-asks when the event stream says something changed.
 */

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcError';
  }
}

/** The first value of a live query, then unsubscribes. */
export function once<T>(watch: Watch<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const subscription: { stop?: () => void } = {};
    // Unsubscribe after the current turn: the first value may arrive before
    // `watch` has even returned its stop function.
    const finish = () => {
      settled = true;
      queueMicrotask(() => subscription.stop?.());
    };
    subscription.stop = watch(
      (value) => {
        if (settled) return;
        finish();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        finish();
        reject(error);
      },
    );
  });
}

function parseRequest(body: unknown): RpcRequest {
  if (!body || typeof body !== 'object') throw new RpcError('Expected a request object');
  const { repo, member, args } = body as Record<string, unknown>;
  if (typeof repo !== 'string' || !Object.hasOwn(REPOSITORY_CONTRACT, repo)) {
    throw new RpcError('Unknown repository');
  }
  const members = REPOSITORY_CONTRACT[repo as keyof typeof REPOSITORY_CONTRACT];
  if (typeof member !== 'string' || !Object.hasOwn(members, member)) {
    throw new RpcError('Unknown repository member');
  }
  if (!Array.isArray(args) || args.length > 4) throw new RpcError('Expected an argument list');
  return { repo: repo as RpcRequest['repo'], member, args };
}

export async function dispatch(repositories: Repositories, body: unknown): Promise<unknown> {
  const { repo, member, args } = parseRequest(body);
  const kind = (REPOSITORY_CONTRACT[repo] as Record<string, string>)[member];
  const target = repositories[repo] as unknown as Record<string, unknown>;

  if (repo === 'backup' && member === 'restore') {
    // Never trust a "validated" backup from the wire: validate it again here.
    const backup = args[0] as { exportedAt?: unknown; data?: BackupData } | undefined;
    if (!backup || typeof backup !== 'object') throw new InvalidInputError('No backup to restore');
    const inspection = repositories.backup.inspect(
      JSON.stringify({
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: backup.exportedAt,
        data: backup.data,
      }),
    );
    if (!inspection.ok) {
      throw new InvalidInputError(
        `The backup didn’t validate: ${inspection.issues[0] ?? inspection.problem}`,
      );
    }
    return repositories.backup.restore(inspection.backup);
  }

  switch (kind) {
    case 'call':
      return (target[member] as (...a: unknown[]) => Promise<unknown>)(...args);
    case 'watch':
      return once(target[member] as Watch<unknown>);
    case 'watchFactory':
      return once((target[member] as (...a: unknown[]) => Watch<unknown>)(...args));
    default:
      throw new RpcError('That member runs in the app, not the companion');
  }
}

const DOMAIN_ERRORS = new Set([
  'RecordNotFoundError',
  'RecordStateError',
  'InvalidInputError',
  'ConstraintError',
  'RpcError',
]);

/** A domain error for the wire; anything else stays calm and generic. */
export function toWireError(error: unknown): WireError {
  if (error instanceof Error && DOMAIN_ERRORS.has(error.name)) {
    return { name: error.name, message: error.message };
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return { name: 'InvalidInputError', message: 'Some of the values weren’t valid' };
  }
  return { name: 'Error', message: 'Something went wrong in the LOWTIDE companion' };
}
