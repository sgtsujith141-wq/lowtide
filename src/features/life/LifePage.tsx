import { Dumbbell, GraduationCap, Moon, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  gridStart,
  weeksForDays,
  YEAR_WEEKS,
  type GridPalette,
} from '../../components/shared/contribution-grid';
import { ContributionGrid } from '../../components/shared/ContributionGrid';
import { addDays, startOfWeek } from '../../lib/calendar';
import { formatDuration } from '../../lib/duration';
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
  const weekStart = startOfWeek(today);
  const watchWeek = useMemo(() => habits.watchEntries(addDays(today, -13), today), [habits, today]);
  const recent = useWatch(watchWeek);
  const { days } = useDaySummaries(gridStart(today, YEAR_WEEKS), today);
  const [announcement, setAnnouncement] = useState('');

  const active = all.status === 'ready' ? all.data.filter((h) => !h.archived) : [];
  const entries = new Map<string, HabitEntry>(
    todays.status === 'ready' ? todays.data.map((e) => [e.habitId, e]) : [],
  );
  const personal = active.filter((h) => CATEGORY_PRESET[h.category] === 'personal');
  const gym = active.filter((h) => CATEGORY_PRESET[h.category] === 'gym');
  const recentEntries = recent.status === 'ready' ? recent.data : [];
  const personalDone = personal.filter((h) => entries.has(h.id)).length;
  const personalDays = new Set(
    recentEntries
      .filter((e) => e.date >= addDays(today, -6) && personal.some((h) => h.id === e.habitId))
      .map((e) => e.date),
  ).size;
  const gymIds = new Set(gym.map((h) => h.id));
  const gymEntries = recentEntries.filter((e) => gymIds.has(e.habitId));
  const gymThisWeek = new Set(gymEntries.filter((e) => e.date >= weekStart).map((e) => e.date))
    .size;
  const lastGym = [...gymEntries].sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastGymType = lastGym ? gym.find((h) => h.id === lastGym.habitId) : undefined;
  const sleepDay = [...days.values()]
    .filter((d) => d.offTimeMinutes > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return (
    <>
      <h1 className="text-page font-semibold">Life</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Area
          icon={Sparkles}
          title="Personal"
          grid="personal"
          today={today}
          days={days}
          facts={[
            [
              'Today',
              personal.length ? `${personalDone} / ${personal.length} done` : 'No routines yet',
            ],
            ['Last 7 days', `${personalDays} ${personalDays === 1 ? 'day' : 'days'}`],
          ]}
        >
          <RoutineLog
            title="Today"
            habits={personal}
            entries={entries}
            today={today}
            defaultCategory="personal"
            addLabel="New personal routine"
            empty="No routines yet."
            onChange={setAnnouncement}
          />
          <p className="mt-2 text-[11px] text-fg-muted">
            Tablets are recorded as taken or not; no dosage advice.
          </p>
        </Area>

        <Area
          icon={Moon}
          title="Sleep & off time"
          grid="sleep"
          today={today}
          days={days}
          facts={[
            ['Last off time', sleepDay ? formatDuration(sleepDay.offTimeMinutes) : 'None yet'],
          ]}
        >
          <OffTimeArea today={today} />
        </Area>

        <Area
          icon={Dumbbell}
          title="Gym"
          grid="gym"
          today={today}
          days={days}
          facts={[
            ['This week', `${gymThisWeek} ${gymThisWeek === 1 ? 'session' : 'sessions'}`],
            [
              'Last',
              lastGym && lastGymType
                ? `${lastGymType.name}${lastGymType.unit === 'minutes' ? ` · ${formatDuration(lastGym.value)}` : ''}`
                : 'None yet',
            ],
          ]}
        >
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
  facts = [],
  children,
}: {
  facts?: [string, string][];
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
    <section aria-labelledby={headingId} className="min-w-0 border-t border-line pt-5">
      <h2 id={headingId} className="flex items-center gap-2 text-section font-semibold">
        <Icon aria-hidden className="size-5 text-fg-muted" /> {title}
      </h2>
      {facts.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-fg-muted">{label}</dt>
              <dd className="figure mt-0.5 text-[15px] font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3">
        <ContributionGrid
          label={`${title}, last 30 days`}
          today={today}
          days={cells}
          palette={grid}
          weeks={weeksForDays(30)}
          since={addDays(today, -29)}
          size="sm"
        />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
