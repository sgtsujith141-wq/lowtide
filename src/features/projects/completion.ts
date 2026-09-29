/**
 * Project completion (ADR-038): completed milestone weight over total
 * milestone weight. Never from time worked, task counts or an AI estimate.
 */
export const DEFAULT_MILESTONE_WEIGHT = 1;

export interface MilestoneProgress {
  /** Omitted means the default weight, 1. Must be a finite number above 0. */
  weight?: number;
  completed: boolean;
}

export interface ProjectCompletion {
  completedWeight: number;
  totalWeight: number;
  /** Whole percent, rounded down, so 100 means every milestone is done. */
  percent: number;
}

/** `null` when there are no milestones: no percentage is shown at all. */
export function projectCompletion(
  milestones: readonly MilestoneProgress[],
): ProjectCompletion | null {
  if (milestones.length === 0) return null;
  let completedWeight = 0;
  let totalWeight = 0;
  for (const milestone of milestones) {
    const weight = milestone.weight ?? DEFAULT_MILESTONE_WEIGHT;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`Milestone weight must be above 0, got ${weight}`);
    }
    totalWeight += weight;
    if (milestone.completed) completedWeight += weight;
  }
  const allDone = milestones.every((m) => m.completed);
  const percent = allDone ? 100 : Math.min(99, Math.floor((completedWeight / totalWeight) * 100));
  return { completedWeight, totalWeight, percent };
}
