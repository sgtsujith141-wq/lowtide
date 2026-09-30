import { Check, ListTodo } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { formatFull, formatWhen } from '../../lib/when';
import type { InboxItem } from '../../types/domain';

type Action = 'convert' | 'process';

/** The inbox: each thought once, oldest first, with two honest ways out. */
export function InboxPage() {
  useDocumentTitle('Inbox');
  const { inbox } = useRepositories();
  const items = useWatch(inbox.watchUnprocessed);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterUpdate = useRef<{ index: number; id: string } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const now = new Date();

  // After an item leaves the list, keep keyboard focus in place: on the item
  // that took its position, or on the heading when the inbox is empty. Runs on
  // both the data update and the tick, and acts only once the item is gone, so
  // it works whichever arrives first.
  useEffect(() => {
    const pending = focusAfterUpdate.current;
    if (!pending || items.status !== 'ready') return;
    if (items.data.some((i) => i.id === pending.id)) return;
    focusAfterUpdate.current = null;
    const index = pending.index;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('[data-primary-action]');
    const target = buttons?.[Math.min(index, buttons.length - 1)];
    (target ?? heading.current)?.focus();
  }, [items, focusTick]);

  // Buttons stay enabled while saving (ADR-030); repeats are ignored here.
  async function act(item: InboxItem, index: number, action: Action) {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      if (action === 'convert') {
        const task = await inbox.convertToTask(item.id);
        setAnnouncement(`Moved to tasks: ${task.title}`);
      } else {
        await inbox.markProcessed(item.id);
        setAnnouncement('Cleared from inbox.');
      }
      focusAfterUpdate.current = { index, id: item.id };
      setFocusTick((t) => t + 1);
    } catch {
      setError(
        action === 'convert'
          ? 'Couldn’t turn that into a task. Nothing changed — it’s still in your inbox.'
          : 'Couldn’t clear that item. Nothing changed — it’s still in your inbox.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 ref={heading} tabIndex={-1} className="text-page font-semibold">
          Inbox
        </h1>
        {items.status === 'ready' && items.data.length > 0 && (
          <p className="text-sm text-fg-muted tabular-nums">{items.data.length} to sort</p>
        )}
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        Make each one a task, or clear it if it needs nothing more.
      </p>

      {error && <ErrorNotice>{error}</ErrorNotice>}
      {items.status === 'error' && (
        <ErrorNotice>Couldn’t read your inbox. Try reloading.</ErrorNotice>
      )}

      {items.status === 'ready' && items.data.length === 0 && (
        <p className="mt-6 text-sm text-fg-muted">
          Nothing waiting. When something’s on your mind,{' '}
          <Link to="/" className="text-accent-ink underline underline-offset-2">
            put it down here
          </Link>
          .
        </p>
      )}

      {items.status === 'ready' && items.data.length > 0 && (
        <ul ref={list} aria-label="Inbox items" className="mt-4 border-t border-line">
          {items.data.map((item, index) => {
            const contentId = `inbox-${item.id}`;
            // Unique button names: the thought's first line, shortened.
            const summary = item.content.split('\n')[0]!.slice(0, 60);
            const busy = busyId === item.id;
            return (
              <li
                key={item.id}
                className="border-b border-line py-2.5"
                aria-busy={busy || undefined}
              >
                <p id={contentId} className="break-words whitespace-pre-wrap">
                  {item.content}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <time
                    dateTime={item.createdAt}
                    title={formatFull(item.createdAt)}
                    className="text-xs text-fg-muted tabular-nums"
                  >
                    {formatWhen(item.createdAt, now)}
                  </time>
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="quiet"
                      data-primary-action
                      aria-label={`Make task: ${summary}`}
                      aria-describedby={contentId}
                      onClick={() => void act(item, index, 'convert')}
                    >
                      <ListTodo aria-hidden className="size-4" />
                      Make task
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Clear: ${summary}`}
                      aria-describedby={contentId}
                      onClick={() => void act(item, index, 'process')}
                    >
                      <Check aria-hidden className="size-4" />
                      Clear
                    </Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Announcer message={announcement} />
    </>
  );
}
