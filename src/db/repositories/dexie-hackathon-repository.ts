import { toTimestamp } from '../../lib/time';
import type { Hackathon } from '../../types/domain';
import { hackathonSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError } from './errors';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { HackathonChanges, HackathonRepository } from './types';

const OPTIONAL_FIELDS = [
  'registrationDeadline',
  'eventStart',
  'eventEnd',
  'team',
  'problemStatement',
  'nextAction',
  'notes',
] as const;

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Parses and applies the V3 date-range rules. */
function validate(record: Record<string, unknown>): Hackathon {
  const hackathon = hackathonSchema.parse(omitUndefined(record));
  if (hackathon.eventEnd !== undefined) {
    if (hackathon.eventStart === undefined) {
      throw new InvalidInputError('An end date needs a start date');
    }
    if (hackathon.eventEnd < hackathon.eventStart) {
      throw new InvalidInputError('The event can’t end before it starts');
    }
  }
  return hackathon;
}

export function createDexieHackathonRepository(deps: RepositoryDeps): HackathonRepository {
  const { db, clock, newId } = resolveDeps(deps);

  return {
    async create(input) {
      const at = toTimestamp(clock());
      const record: Record<string, unknown> = {
        id: newId(),
        name: input.name.trim(),
        status: input.status ?? 'considering',
        registrationStatus: input.registrationStatus ?? 'not_registered',
        pptStatus: input.pptStatus ?? 'not_started',
        buildStatus: input.buildStatus ?? 'not_started',
        createdAt: at,
        updatedAt: at,
      };
      for (const field of OPTIONAL_FIELDS) record[field] = optionalText(input[field]);
      const hackathon = validate(record);
      await db.hackathons.add(hackathon);
      return hackathon;
    },

    update(id, changes: HackathonChanges) {
      return db.transaction('rw', db.hackathons, async () => {
        const existing = await db.hackathons.get(id);
        if (!existing) throw new RecordNotFoundError('Hackathon', id);
        const next: Record<string, unknown> = { ...existing, updatedAt: toTimestamp(clock()) };
        if (changes.name !== undefined) next.name = changes.name.trim();
        for (const key of ['status', 'registrationStatus', 'pptStatus', 'buildStatus'] as const) {
          if (changes[key] !== undefined) next[key] = changes[key];
        }
        for (const field of OPTIONAL_FIELDS) {
          if (changes[field] !== undefined) next[field] = optionalText(changes[field]);
        }
        const hackathon = validate(next);
        await db.hackathons.put(hackathon);
        return hackathon;
      });
    },

    watchAll: watchQuery(async () =>
      (await db.hackathons.toArray()).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    ),
  };
}
