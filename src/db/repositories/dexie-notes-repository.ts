import { toTimestamp } from '../../lib/time';
import type { Id, Note } from '../../types/domain';
import { noteSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError } from './errors';
import { deleteEventsFor, eventWriter } from './ledger';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { NotesRepository } from './types';

/**
 * Project notes (ADR-056). The author is whoever is writing: the owner in
 * the app, or the attributed AI client through the companion. A note is
 * never generated context; generated files are rebuilt from records.
 */
export function createDexieNotesRepository(deps: RepositoryDeps): NotesRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch, source, actor } = resolved;
  const emit = eventWriter(resolved);
  const tables = [db.notes, db.projects, db.events];

  async function getNote(id: Id): Promise<Note> {
    const note = await db.notes.get(id);
    if (!note) throw new RecordNotFoundError('Note', id);
    return note;
  }

  return {
    create(projectId, input) {
      return db.transaction('rw', tables, async () => {
        if (!(await db.projects.get(projectId)))
          throw new RecordNotFoundError('Project', projectId);
        if (source === 'ai-client' && !actor) {
          throw new InvalidInputError('An AI note must name its client');
        }
        const now = clock();
        const at = toTimestamp(now);
        const note = noteSchema.parse(
          omitUndefined({
            id: newId(),
            projectId,
            kind: input.kind ?? 'note',
            title: input.title.trim(),
            body: input.body,
            author: source === 'ai-client' ? 'ai-client' : 'owner',
            client: source === 'ai-client' ? actor : undefined,
            createdAt: at,
            updatedAt: at,
          }),
        );
        await db.notes.add(note);
        await emit(now, { type: 'note.created', entityId: note.id, projectId });
        return note;
      });
    },

    update(id, changes) {
      return db.transaction('rw', tables, async () => {
        const next: Record<string, unknown> = { ...(await getNote(id)) };
        if (changes.title !== undefined) next.title = changes.title.trim();
        if (changes.body !== undefined) next.body = changes.body;
        next.updatedAt = toTimestamp(clock());
        const note = noteSchema.parse(omitUndefined(next));
        await db.notes.put(note);
        return note;
      });
    },

    remove(id) {
      return db.transaction('rw', tables, async () => {
        await getNote(id);
        await db.notes.delete(id);
        await deleteEventsFor(db, 'note', id);
      });
    },

    watchForProject(projectId) {
      return watch(async () =>
        (await db.notes.where('projectId').equals(projectId).toArray()).sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        ),
      );
    },
  };
}
