import { Link } from 'react-router';
import { addDays, eachDay } from '../../lib/calendar';
import type { LocalDate } from '../../types/domain';
import { ProjectCard } from '../projects/ProjectCard';
import { dailyMinutes } from '../projects/summary';
import { useProjectSummaries } from '../projects/useProjectSummaries';

/** Project Command Summary: one rich, compact card per live project. */
export function ProjectCards({ today }: { today: LocalDate }) {
  const data = useProjectSummaries(today);
  const fortnight = eachDay(addDays(today, -13), today);
  if (!data) return null;
  return (
    <section aria-labelledby="projects-heading" className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 id="projects-heading" className="font-serif text-lg font-semibold tracking-tight">
          Projects
        </h2>
        <Link to="/projects" className="text-sm text-accent-ink hover:underline">
          All projects
        </Link>
      </div>
      {data.summaries.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">
          No active projects.{' '}
          <Link to="/projects" className="text-accent-ink hover:underline">
            Start one
          </Link>{' '}
          to see its progress, focus and time here.
        </div>
      ) : (
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.summaries.map((s) => (
            <ProjectCard
              key={s.project.id}
              summary={s}
              spark={dailyMinutes(data.sessions, s.project.id, fortnight)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
