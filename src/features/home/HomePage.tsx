import { format } from 'date-fns';
import { useState } from 'react';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToday } from '../../hooks/useToday';
import { fromLocalDate } from '../../lib/time';
import { ModeActions } from '../modes/ModeActions';
import { AskPanel } from './AskPanel';
import { NeedsYou } from './NeedsYou';
import { ProjectCards } from './ProjectCards';
import { PulseSection, SecondaryGrids } from './PulseSection';
import { Timeline } from '../activity/Timeline';
import { TodaySummary } from './TodaySummary';

/**
 * Home (ADR-043), in order: actions (Start Work, Sleep Mode, Ask LOWTIDE);
 * the year of Daily Pulse; project command summary; what needs you; a compact
 * Today; recent activity; then the individual rhythm grids. The gym is not a
 * Home card.
 */
export function HomePage() {
  useDocumentTitle('Home');
  const today = useToday();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Home</h1>
        <p className="text-sm text-ink-muted">
          <time dateTime={today}>{format(fromLocalDate(today), 'EEEE d MMMM')}</time>
        </p>
      </div>

      <div className="mt-4">
        <ModeActions onAsk={() => setAsking((v) => !v)} />
        {asking && <AskPanel onClose={() => setAsking(false)} />}
      </div>

      <PulseSection today={today} />
      <ProjectCards today={today} />
      <NeedsYou today={today} />
      <TodaySummary today={today} />

      <section aria-labelledby="recent-heading" className="mt-10">
        <h2 id="recent-heading" className="font-serif text-lg font-semibold tracking-tight">
          Recent activity
        </h2>
        <div className="mt-3">
          <Timeline limit={8} />
        </div>
      </section>

      <SecondaryGrids today={today} />
    </>
  );
}
