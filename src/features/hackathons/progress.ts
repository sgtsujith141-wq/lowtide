import type { Hackathon } from '../../types/domain';

/**
 * Hackathon progress (ADR-039, stages widened by ADR-053): visual stages
 * derived only from the hackathon's own fields. No percentage, no time, no
 * tasks, and no link to a Project is needed or implied.
 *
 * Research reads its own recorded status (schema V6, ADR-056); unset means
 * not started. Nothing is inferred from other stages.
 */
export type StageState = 'done' | 'active' | 'todo';
export type StageKey =
  'registration' | 'problem' | 'research' | 'ppt' | 'build' | 'testing' | 'submission';

export const STAGE_LABEL: Record<StageKey, string> = {
  registration: 'Registration',
  problem: 'Problem',
  research: 'Research',
  ppt: 'PPT',
  build: 'Prototype / build',
  testing: 'Testing',
  submission: 'Submission',
};

export interface Stage {
  key: StageKey;
  state: StageState;
}

export function hackathonStages(
  h: Pick<
    Hackathon,
    'registrationStatus' | 'pptStatus' | 'buildStatus' | 'problemStatement' | 'researchStatus'
  >,
): Stage[] {
  const hasProblem = Boolean(h.problemStatement?.trim());
  const stages: Stage[] = [
    {
      key: 'registration',
      state:
        h.registrationStatus === 'registered'
          ? 'done'
          : h.registrationStatus === 'waitlisted'
            ? 'active'
            : 'todo',
    },
    { key: 'problem', state: hasProblem ? 'done' : 'todo' },
    {
      key: 'research',
      state:
        h.researchStatus === 'done'
          ? 'done'
          : h.researchStatus === 'in_progress'
            ? 'active'
            : 'todo',
    },
  ];
  // A PPT that isn't needed isn't a stage at all, rather than a free "done".
  if (h.pptStatus !== 'not_needed') {
    stages.push({
      key: 'ppt',
      state:
        h.pptStatus === 'submitted' ? 'done' : h.pptStatus === 'in_progress' ? 'active' : 'todo',
    });
  }
  stages.push(
    {
      key: 'build',
      state:
        h.buildStatus === 'not_started'
          ? 'todo'
          : h.buildStatus === 'in_progress'
            ? 'active'
            : 'done',
    },
    {
      key: 'testing',
      state:
        h.buildStatus === 'submitted' ? 'done' : h.buildStatus === 'demo_ready' ? 'active' : 'todo',
    },
    { key: 'submission', state: h.buildStatus === 'submitted' ? 'done' : 'todo' },
  );
  return stages;
}
