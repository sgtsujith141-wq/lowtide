import { useMemo } from 'react';
import { useRepositories } from '../../../hooks/useRepositories';
import { useToday } from '../../../hooks/useToday';
import { useWatch, type Live } from '../../../hooks/useWatch';
import { relatedFromRecords, type DatabaseContext } from '../../../lib/space-database';
import { useSpaceData } from '../context';

const list = <T>(live: Live<T[]>): T[] => (live.status === 'ready' ? live.data : []);

/**
 * What computed properties need, live: the records relations point at (for
 * rollups) and today's date (for formulas).
 */
export function useDatabaseContext(): DatabaseContext {
  const { projects, tasks, hackathons } = useRepositories();
  const { nodes } = useSpaceData();
  const today = useToday();
  const all = useWatch(projects.watchAll);
  const milestones = useWatch(projects.watchAllMilestones);
  const items = useWatch(projects.watchAllItems);
  const decisions = useWatch(projects.watchAllDecisions);
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const hacks = useWatch(hackathons.watchAll);
  return useMemo(
    () => ({
      today,
      related: relatedFromRecords({
        tasks: [...list(open), ...list(closed)],
        milestones: list(milestones),
        projectItems: list(items),
        decisions: list(decisions),
        projects: list(all),
        hackathons: list(hacks),
        spaceNodes: nodes,
      }),
    }),
    [today, open, closed, milestones, items, decisions, all, hacks, nodes],
  );
}
