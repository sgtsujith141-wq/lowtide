import { Dumbbell, GraduationCap, Moon, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { gridStart, YEAR_WEEKS, type GridPalette } from '../../components/shared/contribution-grid';
import { RangeGrid } from '../../components/shared/RangeGrid';
import { Announcer } from '../../components/ui/Notice';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { HabitEntry, LocalDate } from '../../types/domain';
import { gridDays, type DaySummary, type ThemedGrid } from '../pulse/days';
import { useDaySummaries } from '../pulse/useDaySummaries';
import { CATEGORY_PRESET } from '../rhythm/presets';
import { CollegeArea } from './CollegeArea';
import { GymArea } from './GymArea';
import { OffTimeArea } from './OffTimeArea';
import { RoutineLog } from './PersonalArea';

/**
 * Life: personal routines, sleep and off time, the gym, and college. Each
 * area has its own grid (same geometry, its own palette, a range switch) and
 * a simple way to record today. Secondary to the Daily Pulse on Home.
 */
export function LifePage() {
  useDocumentTitle('Life');
  const today = useToday();
  const { habits } = useRepositories();
  const all = useWatch(habits.watchAll);
  const watchToday = useMemo(() => habits.watchEntries(today, today), [habits, today]);
  const todays = useWatch(watchToday);
  const { days } = useDaySummaries(gridStart(today, YEAR_WEEKS), today);
  const [announcement, setAnnouncement] = useState('');

  const active = all.status === 'ready' ? all.data.filter((h) => !h.archived) : [];
  const entries = new Map<string, HabitEntry>(
    todays.status === 'ready' ? todays.data.map((e) => [e.habitId, e]) : [],
  );
  const personal = active.filter((h) => CATEGORY_PRESET[h.category] === 'personal');
  const gym = active.filter((h) => CATEGORY_PRESET[h.category] === 'gym');

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">Life</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Routines, rest, movement and college. Recorded, never scored against you.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Area icon={Sparkles} title="Personal" grid="personal" today={today} days={days}>
          <RoutineLog
            title="Today"
            habits={personal}
            entries={entries}
            today={today}
            defaultCategory="personal"
            addLabel="New personal routine"
            empty="Add routines such as tablets (done or not), face wash (a count), a morning or night routine."
            onChange={setAnnouncement}
          />
          <p className="mt-2 text-[11px] text-ink-muted">
            Medication and tablets: LOWTIDE records only whether you took them, and gives no dosage
            advice.
          </p>
        </Area>

        <Area icon={Moon} title="Sleep & off time" grid="sleep" today={today} days={days}>
          <OffTimeArea today={today} />
        </Area>

        <Area icon={Dumbbell} title="Gym" grid="gym" today={today} days={days}>
          <GymArea types={gym} entries={entries} today={today} onChange={setAnnouncement} />
        </Area>

        <Area icon={GraduationCap} title="College" grid="college" today={today} days={days}>
          <CollegeArea today={today} />
        </Area>
      </div>
      <Announcer message={announcement} />
    </>
  );
}

function Area({
  icon: Icon,
  title,
  grid,
  today,
  days,
  children,
}: {
  icon: LucideIcon;
  title: string;
  grid: ThemedGrid & GridPalette;
  today: LocalDate;
  days: Map<LocalDate, DaySummary>;
  children: ReactNode;
}) {
  const cells = useMemo(() => gridDays(days, grid), [days, grid]);
  const headingId = `life-${grid}`;
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-line bg-paper-raised p-4"
    >
      <h2 id={headingId} className="flex items-center gap-2 font-serif text-lg font-semibold">
        <Icon aria-hidden className="size-5 text-ink-muted" /> {title}
      </h2>
      <div className="mt-2">
        <RangeGrid name={title} today={today} days={cells} palette={grid} initial="90" />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
