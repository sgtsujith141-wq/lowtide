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
    <section aria-labelledby="projects-heading" className="mt-10 border-t border-line pt-6">
      <div className="flex items-baseline justify-between">
        <h2 id="projects-heading" className="text-section font-semibold">
          Projects
        </h2>
        <Link to="/projects" className="text-sm text-accent-ink hover:underline">
          All projects
        </Link>
      </div>
      {data.summaries.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">
          No active projects.{' '}
          <Link to="/projects" className="text-accent-ink underline underline-offset-2">
            Start one
          </Link>
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
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
