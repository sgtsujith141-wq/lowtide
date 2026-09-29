import { Heart, Inbox, ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { LocalDate } from '../../types/domain';
import { composeToday } from '../today/compose';

/**
 * A compact view of Today (ADR-020's composition, reused): what's planned,
 * what's pressing, the inbox, and time kept for people and rest. The full
 * page lives at /today.
 */
export function TodaySummary({ today }: { today: LocalDate }) {
  const { tasks, inbox, protectedTime } = useRepositories();
  const watchDay = useMemo(() => tasks.watchForDay(today), [tasks, today]);
  const day = useWatch(watchDay);
  const waiting = useWatch(inbox.watchUnprocessed);
  const watchKept = useMemo(() => protectedTime.watchForDate(today), [protectedTime, today]);
  const kept = useWatch(watchKept);
  const sections = day.status === 'ready' ? composeToday(day.data, today) : null;
  const list = sections ? [...sections.attention, ...sections.planned] : [];

  return (
    <section aria-labelledby="today-summary-heading" className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 id="today-summary-heading" className="font-serif text-lg font-semibold tracking-tight">
          Today
        </h2>
        <Link to="/today" className="text-sm text-accent-ink hover:underline">
          Open Today
        </Link>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-paper-raised p-3">
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <ListChecks aria-hidden className="size-3.5" /> Plan and deadlines
          </p>
          {list.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Nothing planned.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {list.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate">
                  {t.title}
                </li>
              ))}
              {list.length > 4 && (
                <li className="text-xs text-ink-muted">+{list.length - 4} more</li>
              )}
            </ul>
          )}
        </div>
        <Link
          to="/inbox"
          className="rounded-lg border border-line bg-paper-raised p-3 hover:border-line-strong"
        >
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Inbox aria-hidden className="size-3.5" /> Inbox
          </p>
          <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">
            {waiting.status === 'ready' ? waiting.data.length : '–'}
          </p>
          <p className="text-xs text-ink-muted">thoughts to sort</p>
        </Link>
        <div className="rounded-lg border border-line bg-paper-raised p-3">
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Heart aria-hidden className="size-3.5" /> Kept for people and rest
          </p>
          {kept.status === 'ready' && kept.data.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-sm">
              {kept.data.map((p) => (
                <li key={p.id} className="truncate">
                  {p.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">Nothing set aside today.</p>
          )}
        </div>
      </div>
    </section>
  );
}
