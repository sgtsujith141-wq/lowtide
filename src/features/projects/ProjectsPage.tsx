import { Plus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Chip } from '../../components/shared/visuals';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { addDays, eachDay } from '../../lib/calendar';
import { ProjectCard } from './ProjectCard';
import { useProjectSummaries } from './useProjectSummaries';
import { dailyMinutes, STATE_LABEL, STATE_TONE } from './summary';

/** Projects: every live project as a card, a quick "New project", and the finished ones. */
export function ProjectsPage() {
  useDocumentTitle('Projects');
  const today = useToday();
  const data = useProjectSummaries(today);
  const { projects } = useRepositories();
  const all = useWatch(projects.watchAll);
  const [adding, setAdding] = useState(false);
  const fortnight = eachDay(addDays(today, -13), today);
  const finished =
    all.status === 'ready'
      ? all.data.filter((p) => p.state === 'done' || p.state === 'archived')
      : [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Projects</h1>
        <Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          <Plus aria-hidden className="size-4" /> New project
        </Button>
      </div>
      {adding && <NewProjectForm onCancel={() => setAdding(false)} />}

      {data &&
        (data.summaries.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line p-6 text-sm text-ink-muted">
            No active projects. A project gets a command room: milestones, what’s happening now,
            what’s waiting, what needs you, and its own history.
          </div>
        ) : (
          <ul
            aria-label="Active projects"
            className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {data.summaries.map((s) => (
              <ProjectCard
                key={s.project.id}
                summary={s}
                spark={dailyMinutes(data.sessions, s.project.id, fortnight)}
              />
            ))}
          </ul>
        ))}

      {finished.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-ink-muted">
            Done and archived ({finished.length})
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {finished.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <Link to={`/projects/${p.slug}`} className="text-sm hover:underline">
                  {p.name}
                </Link>
                <Chip tone={STATE_TONE[p.state]}>{STATE_LABEL[p.state]}</Chip>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function NewProjectForm({ onCancel }: { onCancel: () => void }) {
  const { projects } = useRepositories();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), objective: useId(), error: useId() };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Give the project a name.');
    try {
      const project = await projects.create({ name, objective, state: 'active' });
      await navigate(`/projects/${project.slug}`);
    } catch {
      setError('Couldn’t create the project. Nothing changed.');
    }
  }

  return (
    <form
      aria-label="New project"
      onSubmit={(e) => void submit(e)}
      className="mt-4 max-w-lg space-y-3 rounded-xl border border-line bg-paper-raised p-4"
    >
      <div>
        <label htmlFor={ids.name} className={labelClass}>
          Name
        </label>
        <input
          id={ids.name}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={ids.objective} className={labelClass}>
          Objective (optional): what does done mean?
        </label>
        <input
          id={ids.objective}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          className={fieldClass}
        />
      </div>
      {error && <ErrorNotice id={ids.error}>{error}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Create project
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
