import { Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import type { CompanionClient } from '../../db/companion/client';
import type { AiChange, Grant } from '../../db/companion/wire';
import { formatFull, formatWhen } from '../../lib/when';
import { useAiChangesSince } from './ai-visits';

/*
 * What AI changed (v2.1): every change an AI client made, in plain words,
 * newest first, with an undo where LOWTIDE can put it back exactly. A change
 * that something else has touched since can't be undone blindly; the
 * companion says why, and that reason is shown here.
 */

/** A small count for the navigation rail: AI changes since the last visit. */
export function AiChangesBadge({ client }: { client: CompanionClient | null | undefined }) {
  const count = useAiChangesSince(client);
  if (!count) return null;
  return (
    <span
      className="rounded-full bg-accent-soft px-1.5 text-[10px] leading-4 font-medium text-accent-ink"
      aria-label={`${count} AI ${count === 1 ? 'change' : 'changes'} since your last visit`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function useChanges(client: CompanionClient) {
  const [changes, setChanges] = useState<AiChange[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setChanges(await client.changes(300));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const off = client.onEvent((e) => {
      if (e.type === 'ai') void load();
    });
    return () => {
      clearTimeout(first);
      off();
    };
  }, [client, load]);
  return { changes, failed, reload: load };
}

/** Consecutive changes made by one bulk call form a group. */
function groups(list: AiChange[]): AiChange[][] {
  const out: AiChange[][] = [];
  for (const c of list) {
    const last = out.at(-1);
    if (last && c.batchId && last[0]!.batchId === c.batchId) last.push(c);
    else out.push([c]);
  }
  return out;
}

export function AiChanges({
  client,
  grants,
  onlyGrant,
  onShowAll,
}: {
  client: CompanionClient;
  grants: Grant[];
  /** Show only this grant's changes (View activity). */
  onlyGrant?: string | undefined;
  onShowAll: () => void;
}) {
  const { changes, failed, reload } = useChanges(client);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const now = new Date();
  const shown = (changes ?? []).filter((c) => !onlyGrant || c.grantId === onlyGrant);
  const grantLabel = onlyGrant ? grants.find((g) => g.id === onlyGrant)?.label : undefined;

  async function undo(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    setProblems((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    try {
      await run();
      await reload();
    } catch (error) {
      setProblems((p) => ({
        ...p,
        [key]: error instanceof Error ? error.message : 'Couldn’t undo that.',
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="changes-heading" className="mt-8 border-t border-line pt-6">
      <h2 id="changes-heading" className="text-section font-semibold">
        What AI changed
      </h2>
      {onlyGrant && (
        <p className="mt-1 text-sm text-fg-muted">
          Showing changes by {grantLabel ?? 'one client'} ·{' '}
          <button type="button" onClick={onShowAll} className="text-accent-ink underline">
            Show all
          </button>
        </p>
      )}
      {failed && <ErrorNotice>Couldn’t read the changes from the companion.</ErrorNotice>}
      {changes && shown.length === 0 && (
        <p className="mt-2 text-sm text-fg-muted">No changes yet.</p>
      )}
      {shown.length > 0 && (
        <ol aria-label="AI changes" className="mt-2 divide-y divide-line text-sm">
          {groups(shown).map((group) => {
            const first = group[0]!;
            const batch = group.length > 1 ? first.batchId : undefined;
            const batchUndoable = batch && group.some((c) => c.revertible);
            return (
              <li key={first.id} className="py-2">
                {batch && (
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-fg-muted">
                      {first.client} · {group.length} changes in one go ·{' '}
                      <time dateTime={first.at} title={formatFull(first.at)}>
                        {formatWhen(first.at, now)}
                      </time>
                    </p>
                    {batchUndoable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void undo(batch, () => client.revertBatch(batch))}
                      >
                        <Undo2 aria-hidden className="size-3.5" /> Undo all {group.length}
                      </Button>
                    )}
                  </div>
                )}
                {problems[batch ?? ''] && <ErrorNotice>{problems[batch!]}</ErrorNotice>}
                <ul className={batch ? 'ml-3 border-l border-line pl-3' : ''}>
                  {group.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-1"
                    >
                      <p className="min-w-0 flex-1">
                        <span className="font-medium">{c.client}</span>
                        {' · '}
                        <span className={c.revertedAt ? 'text-fg-muted line-through' : ''}>
                          {c.summary}
                        </span>
                        {' · '}
                        <time
                          dateTime={c.at}
                          title={formatFull(c.at)}
                          className="text-xs text-fg-muted"
                        >
                          {formatWhen(c.at, now)}
                        </time>
                        {c.revertedAt && (
                          <span className="ml-1 text-xs text-fg-muted">(undone)</span>
                        )}
                      </p>
                      {c.revertible && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          aria-label={`Undo: ${c.summary}`}
                          onClick={() => void undo(c.id, () => client.revertChange(c.id))}
                        >
                          <Undo2 aria-hidden className="size-3.5" /> Undo
                        </Button>
                      )}
                      {problems[c.id] && (
                        <p role="alert" className="w-full text-xs text-danger">
                          {problems[c.id]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
