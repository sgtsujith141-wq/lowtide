import { useMemo } from 'react';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { Timeline } from '../activity/Timeline';

/**
 * Recent activity on Home (v2 PHASE 012): the latest few events from the
 * ledger, and nothing at all when there's none. The full history lives in
 * each project's History tab.
 */
export function RecentActivity() {
  const { events } = useRepositories();
  const watch = useMemo(() => events.watchRecent({ limit: 1 }), [events]);
  const any = useWatch(watch);
  if (any.status !== 'ready' || any.data.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="mt-12" data-nonessential>
      <h2 id="recent-heading" className="text-section font-semibold">
        Recent
      </h2>
      <div className="mt-3 max-w-[60rem]">
        <Timeline limit={5} clamp emptyText={null} />
      </div>
    </section>
  );
}
