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
    <section aria-labelledby="today-summary-heading" className="mt-10 border-t border-line pt-6">
      <div className="flex items-baseline justify-between">
        <h2 id="today-summary-heading" className="text-section font-semibold">
          Today
        </h2>
        <Link to="/today" className="text-sm text-accent-ink hover:underline">
          Open Today
        </Link>
      </div>
      <div className="mt-3 grid gap-y-5 sm:grid-cols-3 sm:divide-x sm:divide-line [&>*]:min-w-0 sm:[&>*]:px-5 sm:[&>*:first-child]:pl-0">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <ListChecks aria-hidden className="size-3.5" /> Plan and deadlines
          </p>
          {list.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">Nothing planned.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {list.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate">
                  {t.title}
                </li>
              ))}
              {list.length > 4 && (
                <li className="text-xs text-fg-muted">+{list.length - 4} more</li>
              )}
            </ul>
          )}
        </div>
        <Link to="/inbox" className="group block rounded-md transition-colors duration-150">
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Inbox aria-hidden className="size-3.5" /> Inbox
          </p>
          <p className="figure mt-1 text-2xl font-semibold group-hover:underline">
            {waiting.status === 'ready' ? waiting.data.length : '–'}
          </p>
          <p className="text-xs text-fg-muted">thoughts to sort</p>
        </Link>
        <div>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Heart aria-hidden className="size-3.5 text-personal-4" /> Kept for people and rest
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
            <p className="mt-1 text-sm text-fg-muted">Nothing set aside today.</p>
          )}
        </div>
      </div>
    </section>
  );
}
