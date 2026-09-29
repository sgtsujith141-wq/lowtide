import { Check } from 'lucide-react';
import type { Hackathon } from '../../types/domain';
import { hackathonStages, STAGE_LABEL, type StageState } from './progress';

const WORD: Record<StageState, string> = { done: 'done', active: 'in progress', todo: 'to do' };

/**
 * The hackathon's stages as a compact rail (ADR-053): ✓ done, ● in progress,
 * ○ to do. Derived only from the sheet's own statuses; no percentage.
 */
export function StageRail({ hackathon }: { hackathon: Hackathon }) {
  const stages = hackathonStages(hackathon);
  return (
    <ol
      aria-label={`Stages for ${hackathon.name}`}
      className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1.5"
    >
      {stages.map((stage, i) => (
        <li key={stage.key} className="flex items-center gap-1">
          {i > 0 && (
            <span
              aria-hidden
              className={`h-px w-3 ${stage.state === 'todo' ? 'bg-line' : 'bg-accent'}`}
            />
          )}
          <span
            className={`inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] ${
              stage.state === 'done'
                ? 'bg-accent-soft text-accent-ink'
                : stage.state === 'active'
                  ? 'bg-work-1 font-medium text-ink'
                  : 'text-ink-muted'
            }`}
          >
            {stage.state === 'done' ? (
              <Check aria-hidden className="size-3" strokeWidth={3} />
            ) : (
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  stage.state === 'active' ? 'bg-work-3' : 'border border-ink-faint'
                }`}
              />
            )}
            {STAGE_LABEL[stage.key]}
            <span className="sr-only">: {WORD[stage.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
