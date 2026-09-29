import { useId, useState } from 'react';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import type { Project } from '../../../types/domain';
import { ContextPreview } from '../../context/ContextPreview';
import { useSnapshot } from '../../context/useSnapshot';

/**
 * Context for a coding agent working on this project (PROJECT scope, the
 * default, ADR-041), optionally narrowed to a milestone and a current task.
 */
export function ContextPanel({ project }: { project: Project }) {
  const { data, error, refresh } = useSnapshot();
  const [milestoneId, setMilestoneId] = useState('');
  const [taskId, setTaskId] = useState('');
  const ids = { milestone: useId(), task: useId() };
  if (error) return <p className="text-sm text-danger">Couldn’t read this project’s data.</p>;
  if (!data) return null;
  const milestones = data.milestones
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.order - b.order);
  const tasks = data.tasks.filter(
    (t) => t.projectId === project.id && (t.status === 'todo' || t.status === 'doing'),
  );
  return (
    <section aria-labelledby="context-heading" className="space-y-3">
      <div>
        <h3 id="context-heading" className="text-sm font-semibold">
          Context for AI clients
        </h3>
        <p className="text-xs text-ink-muted">
          Project scope: only this project’s technical context. Protected time and private life
          records are never included. Nothing is sent anywhere; copy it, download it, or export the
          workspace for a connected client.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor={ids.milestone} className={labelClass}>
            Subarea (optional)
          </label>
          <select
            id={ids.milestone}
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
            className={`${fieldClass} w-auto`}
          >
            <option value="">Whole project</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.task} className={labelClass}>
            Current task (optional)
          </label>
          <select
            id={ids.task}
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className={`${fieldClass} w-auto`}
          >
            <option value="">None</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ContextPreview
        data={data}
        scope={{
          kind: 'project',
          projectId: project.id,
          ...(milestoneId ? { milestoneId } : {}),
          ...(taskId ? { taskId } : {}),
        }}
        fileName="CONTEXT.md"
        onRefresh={refresh}
      />
    </section>
  );
}
