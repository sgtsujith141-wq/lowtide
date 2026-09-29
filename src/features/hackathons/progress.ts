import type { Hackathon } from '../../types/domain';

/**
 * Hackathon progress (ADR-039): visual stages derived only from the
 * hackathon's own status fields. No percentage, no time, no tasks, and no
 * link to a Project is needed or implied.
 */
export type StageState = 'done' | 'active' | 'todo';
export type StageKey = 'registered' | 'ppt' | 'build' | 'demo' | 'submitted';

export interface Stage {
  key: StageKey;
  state: StageState;
}

export function hackathonStages(
  hackathon: Pick<Hackathon, 'registrationStatus' | 'pptStatus' | 'buildStatus'>,
): Stage[] {
  const { registrationStatus, pptStatus, buildStatus } = hackathon;
  const stages: Stage[] = [
    {
      key: 'registered',
      state:
        registrationStatus === 'registered'
          ? 'done'
          : registrationStatus === 'waitlisted'
            ? 'active'
            : 'todo',
    },
  ];
  // A PPT that isn't needed isn't a stage at all, rather than a free "done".
  if (pptStatus !== 'not_needed') {
    stages.push({
      key: 'ppt',
      state: pptStatus === 'submitted' ? 'done' : pptStatus === 'in_progress' ? 'active' : 'todo',
    });
  }
  stages.push(
    {
      key: 'build',
      state:
        buildStatus === 'not_started' ? 'todo' : buildStatus === 'in_progress' ? 'active' : 'done',
    },
    {
      key: 'demo',
      state: buildStatus === 'demo_ready' || buildStatus === 'submitted' ? 'done' : 'todo',
    },
    { key: 'submitted', state: buildStatus === 'submitted' ? 'done' : 'todo' },
  );
  return stages;
}
