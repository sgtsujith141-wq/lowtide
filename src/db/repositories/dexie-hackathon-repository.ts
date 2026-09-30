import { toTimestamp } from '../../lib/time';
import type { Hackathon } from '../../types/domain';
import { hackathonSchema } from '../schema';
import { checkHackathonDates } from '../rules';
import { RecordNotFoundError } from './errors';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
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
  checkHackathonDates(hackathon);
  return hackathon;
}

export function createDexieHackathonRepository(deps: RepositoryDeps): HackathonRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch } = resolved;

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
        researchStatus: input.researchStatus,
        createdAt: at,
        updatedAt: at,
      };
      for (const field of OPTIONAL_FIELDS) record[field] = optionalText(input[field]);
      const hackathon = validate(record);
      await db.hackathons.add(hackathon);
      return hackathon;
    },

    update(id, changes: HackathonChanges) {
      return db.transaction('rw', db.hackathons, db.projects, async () => {
        const existing = await db.hackathons.get(id);
        if (!existing) throw new RecordNotFoundError('Hackathon', id);
        const next: Record<string, unknown> = { ...existing, updatedAt: toTimestamp(clock()) };
        if (changes.name !== undefined) next.name = changes.name.trim();
        for (const key of [
          'status',
          'registrationStatus',
          'pptStatus',
          'buildStatus',
          'researchStatus',
        ] as const) {
          if (changes[key] !== undefined) next[key] = changes[key];
        }
        for (const field of OPTIONAL_FIELDS) {
          if (changes[field] !== undefined) next[field] = optionalText(changes[field]);
        }
        if (changes.projectId !== undefined) {
          if (changes.projectId !== null && !(await db.projects.get(changes.projectId))) {
            throw new RecordNotFoundError('Project', changes.projectId);
          }
          next.projectId = changes.projectId ?? undefined;
        }
        const hackathon = validate(next);
        await db.hackathons.put(hackathon);
        return hackathon;
      });
    },

    watchAll: watch(async () =>
      (await db.hackathons.toArray()).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    ),
  };
}
