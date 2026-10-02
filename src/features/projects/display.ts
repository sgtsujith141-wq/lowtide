import type { Milestone, Project, ProjectItem } from '../../types/domain';
import { withoutProjectPrefix } from '../home/model';
import type { LaneEntry, ProjectSummary } from './summary';

/*
 * How projects read on portfolio surfaces (v2 PHASE 013), from their records
 * only (pure, deterministic; nothing is generated at render time). The full
 * wording always stays one step away, in details and source context.
 */

/** Longest display title on a portfolio surface before it's shortened. */
export const CONCISE_MAX = 64;

export interface Concise {
  /** What a portfolio surface shows. */
  text: string;
  /** The record's own wording. */
  full: string;
  shortened: boolean;
}

/**
 * Recurring phrasings in imported planning notes, said plainly. Each rule is
 * a fixed pattern; anything it doesn't match falls through to trimming.
 */
const PHRASES: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /\bnot (?:listed|included|tracked) in (?:either|any|the|both)\b.*\bportfolios?\b/i,
    () => 'Portfolio position needs confirmation',
  ],
  [
    /^(.+?)\s+lists\s+(.+?)\s+as\s+(primary|secondary|supporting|priority|active|parked|later)\b.*\binstead\b/i,
    (m) => `Priority recorded differently in ${m[1]!.trim()}`,
  ],
];

const LABEL = /^(?:blocked|blocker|conflict|note|fyi|todo|waiting(?: on)?|approval)\s*[:—–-]\s*/i;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A display title for an imported or long record title: the project's own
 * name and status labels dropped ("Blocked:", "CONFLICT:"), known phrasings
 * said plainly, parentheticals removed, then the first clause, cut at a word
 * boundary. Short, plain titles come back as they are.
 */
export function concise(full: string, projectName?: string, max = CONCISE_MAX): Concise {
  const original = full.trim();
  let text = projectName ? withoutProjectPrefix(original, projectName) : original;
  text = text.replace(LABEL, '').replace(/^[A-Z][A-Z0-9 ._-]{1,24}\d[^:]{0,24}:\s+/, '');
  for (const [pattern, say] of PHRASES) {
    const m = text.match(pattern);
    if (m) {
      const said = say(m);
      return { text: said, full: original, shortened: said !== original };
    }
  }
  text = text.replace(/\s*\([^)]*\)/g, '').trim();
  if (text.length > max) {
    const clause = text.split(/\s+[—–-]\s+|;\s+|\.\s+/)[0]!;
    if (clause.length >= 12) text = clause;
  }
  text = text.replace(/[.;:,]+$/, '');
  if (text.length > max) {
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    text = `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
  }
  text = capitalise(text);
  return { text, full: original, shortened: text !== original };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Board entries in roadmap order: an entry whose title names a milestone
 * sits at that milestone's place; the rest keep their order after them.
 */
export function byRoadmap(
  entries: readonly LaneEntry[],
  milestones: readonly Milestone[],
  projectName: string,
): LaneEntry[] {
  const place = new Map(
    milestones.map((m, i) => [norm(withoutProjectPrefix(m.title, projectName)), i]),
  );
  const rank = (e: LaneEntry) =>
    place.get(norm(withoutProjectPrefix(e.title, projectName))) ?? Infinity;
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e);
}

export interface NowNext {
  now?: string | undefined;
  next?: string | undefined;
}

/**
 * What's happening now and what comes next. Now: the first item worked on,
 * else the current milestone. Next: the milestone after it, else the next
 * step on the board, else the recorded next action. Never the same thing
 * twice, and never with the project's name in front.
 */
export function nowNext(s: ProjectSummary): NowNext {
  const name = s.project.name;
  const clean = (t: string | undefined) => (t ? withoutProjectPrefix(t, name) : undefined);
  const after = s.currentMilestone
    ? s.milestones.find((m) => m.order > s.currentMilestone!.order && !m.completedAt)
    : undefined;
  const working = byRoadmap(s.lanes.working_now, s.milestones, name);
  const upcoming = byRoadmap(s.lanes.next, s.milestones, name);
  const nowCandidates = [working[0]?.title, s.currentMilestone?.title];
  const now = clean(nowCandidates.find(Boolean));
  const seen = new Set(
    [now, ...working.map((e) => e.title)].filter(Boolean).map((t) => norm(clean(t)!)),
  );
  const nextCandidates = [
    working[0] ? s.currentMilestone?.title : undefined,
    after?.title,
    ...upcoming.map((e) => e.title),
    s.project.nextAction,
  ];
  const next = nextCandidates
    .map(clean)
    .find((t): t is string => t !== undefined && !seen.has(norm(t)));
  return { now, next };
}

/** Where a project sits in the portfolio, from its focus and state. */
export const TIERS = ['primary', 'secondary', 'supporting', 'unsorted', 'later', 'other'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  supporting: 'Supporting',
  unsorted: 'Active',
  later: 'Later',
  other: 'Not current',
};

/**
 * Focus decides the tier. A project marked "not current" that is still being
 * planned or is parked reads as Later; otherwise as Not current. A project
 * with no focus set is simply Active.
 */
export function tierOf(project: Project): Tier {
  switch (project.focus) {
    case 'primary':
    case 'secondary':
    case 'supporting':
      return project.focus;
    case 'background':
      return project.state === 'planning' || project.state === 'parked' ? 'later' : 'other';
    default:
      return 'unsorted';
  }
}

export interface Health {
  /** One plain line. */
  text: string;
  tone: 'clear' | 'attention' | 'quiet';
}

/** Project health in words: what's in the way, or that nothing is. Never a score. */
export function healthOf(s: ProjectSummary): Health {
  const blocked = s.lanes.blocked.length;
  const approvals = s.lanes.needs_approval.length;
  const waiting = s.lanes.waiting.length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (s.project.state === 'parked') return { text: 'Parked', tone: 'quiet' };
  if (s.project.state === 'done' || s.project.state === 'archived')
    return { text: s.project.state === 'done' ? 'Done' : 'Archived', tone: 'quiet' };
  if (blocked || approvals) {
    const parts = [
      blocked ? plural(blocked, 'blocker', 'blockers') : '',
      approvals ? plural(approvals, 'approval', 'approvals') : '',
    ].filter(Boolean);
    return { text: `Needs you: ${parts.join(', ')}`, tone: 'attention' };
  }
  if (waiting) return { text: `Waiting on ${plural(waiting, 'thing', 'things')}`, tone: 'quiet' };
  return { text: 'Nothing blocked or waiting on you', tone: 'clear' };
}

/** Milestone count in words: "2 of 7 milestones". */
export function milestoneCount(milestones: readonly Milestone[]): string {
  const done = milestones.filter((m) => m.completedAt).length;
  return `${done} of ${milestones.length} milestone${milestones.length === 1 ? '' : 's'}`;
}

export interface NeedEntry {
  kind: 'approval' | 'blocker';
  entry: LaneEntry;
  item: ProjectItem | undefined;
}

/** Approvals, then blockers: the things that can't move without the owner. */
export function needsOf(s: ProjectSummary, items: readonly ProjectItem[]): NeedEntry[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const isBlocker = (e: LaneEntry) => e.kind === 'item' && byId.get(e.id)?.kind === 'blocker';
  return [
    ...s.lanes.needs_approval.map((entry) => ({
      kind: 'approval' as const,
      entry,
      item: byId.get(entry.id),
    })),
    ...s.lanes.blocked
      .filter(isBlocker)
      .map((entry) => ({ kind: 'blocker' as const, entry, item: byId.get(entry.id) })),
  ];
}
