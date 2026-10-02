import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { gridStart, YEAR_WEEKS } from '../../components/shared/contribution-grid';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNow } from '../../hooks/useNow';
import { useToday } from '../../hooks/useToday';
import { fromLocalDate } from '../../lib/time';
import { ModeActions } from '../modes/ModeActions';
import { useProjectSummaries } from '../projects/useProjectSummaries';
import { useDaySummaries } from '../pulse/useDaySummaries';
import { CommandPalette } from './AskPanel';
import { greeting } from './model';
import { NeedsYou } from './NeedsYou';
import { ProjectCommand } from './ProjectCommand';
import { PulseHero } from './PulseHero';
import { RecentActivity } from './RecentActivity';
import { RhythmPreview } from './RhythmPreview';
import { TodayStrip } from './TodayStrip';

/**
 * Home v3 (v2 PHASE 012). Understood in seconds, top to bottom:
 * how the year is going (the Daily Pulse), which projects are moving
 * (Project Command), what needs you, today in figures and what's next, the
 * latest few events, and one rhythm at a time. Deeper detail lives on its
 * own screen; sections with nothing to say stay hidden.
 */
export function HomePage() {
  useDocumentTitle('Home');
  const today = useToday();
  const now = useNow(true, 60_000);
  const [searching, setSearching] = useState(false);
  const { days, status } = useDaySummaries(gridStart(today, YEAR_WEEKS), today);
  const projects = useProjectSummaries(today);

  // ⌘K / Ctrl+K opens the search from anywhere on Home.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="sr-only">Home</h1>
          <p className="text-page font-semibold">{greeting(now)}.</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            <time dateTime={today}>{format(fromLocalDate(today), 'EEEE d MMMM')}</time>
          </p>
        </div>
        <ModeActions onAsk={() => setSearching(true)} />
      </div>
      <CommandPalette open={searching} onClose={() => setSearching(false)} />

      <PulseHero today={today} days={days} ready={status === 'ready'} />
      {projects && <ProjectCommand summaries={projects.summaries} now={now} />}
      <NeedsYou today={today} />
      {projects && <TodayStrip today={today} summaries={projects.summaries} now={now} />}
      <RecentActivity />
      <div data-nonessential>
        <RhythmPreview today={today} days={days} />
      </div>
    </>
  );
}
