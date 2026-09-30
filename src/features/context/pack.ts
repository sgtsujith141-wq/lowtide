import type { BackupData } from '../../db/repositories';
import { addDays, startOfWeek } from '../../lib/calendar';
import { formatDuration } from '../../lib/duration';
import { localDateOfDeadline, toLocalDate } from '../../lib/time';
import {
  PRIVATE_EVENT_TYPES,
  type Decision,
  type LedgerEvent,
  type LocalDate,
  type Project,
} from '../../types/domain';
import { hackathonStages, STAGE_LABEL } from '../hackathons/progress';
import { LANE_LABEL, STATE_LABEL, summariseProject } from '../projects/summary';
import { activeMinutes } from '../work/duration';

/*
 * The context engine (ADR-041, ADR-054): small, scoped, explainable context
 * packs built from one consistent snapshot of LOWTIDE (the backup export),
 * pure and deterministic.
 *
 * Hierarchy: GLOBAL → PROJECT → SUBAREA (a milestone) → CURRENT TASK.
 * - PROJECT (the default for coding agents): one project's technical context.
 * - WORKSPACE: every live project and hackathon, still technical only.
 * - GLOBAL: WORKSPACE plus, only when explicitly granted, private summaries
 *   (routines, off time, college, inbox).
 * Protected time is never included, in any scope, and there is no grant for it.
 */

export type ContextScope =
  | { kind: 'project'; projectId: string; milestoneId?: string; taskId?: string }
  | { kind: 'workspace' }
  | { kind: 'global'; grants: GlobalGrants };

/** Private areas a person may explicitly allow a broad assistant to see. */
export interface GlobalGrants {
  routines?: boolean;
  offTime?: boolean;
  college?: boolean;
  inbox?: boolean;
}

export interface ContextSection {
  title: string;
  lines: string[];
}

export interface ContextPack {
  scope: ContextScope['kind'];
  /** e.g. ['GLOBAL', 'PROJECT: Engine', 'SUBAREA: Build', 'CURRENT TASK: Wire it'] */
  hierarchy: string[];
  generatedAt: string;
  sections: ContextSection[];
  /** Every record the pack drew on, so any line can be traced. */
  sources: { store: string; id: string }[];
  /** Private areas included because they were explicitly granted (GLOBAL only). */
  granted: string[];
}

const RECENT = 10;

function eventText(event: LedgerEvent, titles: Map<string, string>): string {
  const title = titles.get(event.entityId);
  const base: Record<LedgerEvent['type'], string> = {
    'work.started': 'Started work',
    'work.paused': 'Paused work',
    'work.resumed': 'Resumed work',
    'work.finished': 'Finished a work session',
    'offtime.started': 'Off time began',
    'offtime.ended': 'Off time ended',
    'habit.logged': 'Logged a routine',
    'task.completed': 'Completed task',
    'milestone.completed': 'Reached milestone',
    'project.updated': 'Project updated',
    'project.approval_requested': 'Approval requested',
    'project.item_parked': 'Parked',
    'decision.recorded': 'Decision recorded',
    'ai.session.completed': 'AI session',
    'note.created': 'Note added',
  };
  if (event.type === 'project.updated' && event.data.change === 'state')
    return `${event.at.slice(0, 10)} State ${event.data.from} → ${event.data.to}`;
  if (event.type === 'project.updated' && event.data.change === 'created')
    return `${event.at.slice(0, 10)} Project created`;
  return `${event.at.slice(0, 10)} ${base[event.type]}${title ? `: ${title}` : ''}`;
}

function titlesOf(data: BackupData): Map<string, string> {
  const titles = new Map<string, string>();
  for (const t of data.tasks) titles.set(t.id, t.title);
  for (const m of data.milestones) titles.set(m.id, m.title);
  for (const i of data.projectItems) titles.set(i.id, i.title);
  for (const d of data.decisions) titles.set(d.id, d.title);
  for (const p of data.projects) titles.set(p.id, p.name);
  for (const s of data.workSessions) if (s.intent) titles.set(s.id, s.intent);
  for (const a of data.aiSessions) titles.set(a.id, a.summary);
  return titles;
}

/** Decisions newest first, with superseded ones marked. */
export function decisionLines(decisions: readonly Decision[], limit = 5): string[] {
  const superseded = new Set(decisions.map((d) => d.supersedesId).filter(Boolean));
  return [...decisions]
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
    .slice(0, limit)
    .map(
      (d) =>
        `${d.decidedAt.slice(0, 10)} ${d.title}: ${d.decision}${superseded.has(d.id) ? ' (superseded)' : ''}`,
    );
}

function projectSections(
  data: BackupData,
  project: Project,
  today: LocalDate,
  sources: ContextPack['sources'],
): ContextSection[] {
  const tasks = data.tasks;
  const summary = summariseProject(
    project,
    data.milestones,
    data.projectItems,
    tasks,
    data.workSessions,
    today,
  );
  sources.push({ store: 'projects', id: project.id });
  for (const m of summary.milestones) sources.push({ store: 'milestones', id: m.id });
  const items = data.projectItems.filter((i) => i.projectId === project.id);
  for (const i of items) sources.push({ store: 'projectItems', id: i.id });
  const lane = (key: keyof typeof summary.lanes) =>
    summary.lanes[key].map((e) => `- ${e.title}${e.detail ? ` (waiting on ${e.detail})` : ''}`);

  const sections: ContextSection[] = [
    {
      title: 'Objective',
      lines: [project.objective ?? 'Not recorded.'],
    },
    {
      title: 'State',
      lines: [
        `State: ${STATE_LABEL[project.state]}`,
        ...(project.phase ? [`Phase: ${project.phase}`] : []),
        ...(project.nextAction ? [`Next action: ${project.nextAction}`] : []),
        ...(project.repoUrl ? [`Repository: ${project.repoUrl}`] : []),
      ],
    },
    {
      title: 'Progress',
      lines: summary.completion
        ? [
            `${summary.completion.percent}% of milestone weight complete (${summary.completion.completedWeight} of ${summary.completion.totalWeight}).`,
            ...summary.milestones.map(
              (m) =>
                `- [${m.completedAt ? 'x' : m.id === summary.currentMilestone?.id ? '>' : ' '}] ${m.title}${m.weight !== 1 ? ` (weight ${m.weight})` : ''}${m.dueOn ? ` due ${m.dueOn}` : ''}`,
            ),
          ]
        : ['No milestones yet, so no completion percentage.'],
    },
    { title: LANE_LABEL.working_now, lines: lane('working_now') },
    { title: LANE_LABEL.next, lines: lane('next') },
    { title: LANE_LABEL.waiting, lines: lane('waiting') },
    { title: LANE_LABEL.needs_approval, lines: lane('needs_approval') },
    { title: LANE_LABEL.blocked, lines: lane('blocked') },
    { title: LANE_LABEL.parked, lines: lane('parked') },
    {
      title: 'Time',
      lines: [
        `${formatDuration(summary.minutesThisWeek)} this week, ${formatDuration(summary.minutesTotal)} in total.`,
      ],
    },
  ];

  const decisions = data.decisions.filter((d) => d.projectId === project.id);
  for (const d of decisions) sources.push({ store: 'decisions', id: d.id });
  sections.push({ title: 'Recent decisions', lines: decisionLines(decisions) });

  const titles = titlesOf(data);
  const events = data.events
    .filter((e) => e.projectId === project.id && !PRIVATE_EVENT_TYPES.includes(e.type))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT);
  for (const e of events) sources.push({ store: 'events', id: e.id });
  sections.push({
    title: 'Recent activity',
    lines: events.map((e) => `- ${eventText(e, titles)}`),
  });

  sections.push({
    title: 'Important documents',
    lines: [
      `- projects/${project.slug}/PROJECT.md`,
      `- projects/${project.slug}/decisions/`,
      `- projects/${project.slug}/docs/`,
      `- projects/${project.slug}/ai/handoffs/`,
    ],
  });
  return sections;
}

export function buildContextPack(data: BackupData, scope: ContextScope, now: Date): ContextPack {
  const today = toLocalDate(now);
  const sources: ContextPack['sources'] = [];
  const pack: ContextPack = {
    scope: scope.kind,
    hierarchy: [],
    generatedAt: now.toISOString(),
    sections: [],
    sources,
    granted: [],
  };

  if (scope.kind === 'project') {
    const project = data.projects.find((p) => p.id === scope.projectId);
    if (!project) throw new RangeError(`No project ${scope.projectId}`);
    pack.hierarchy = ['GLOBAL', `PROJECT: ${project.name}`];
    const milestone = scope.milestoneId
      ? data.milestones.find((m) => m.id === scope.milestoneId && m.projectId === project.id)
      : undefined;
    const task = scope.taskId
      ? data.tasks.find((t) => t.id === scope.taskId && t.projectId === project.id)
      : undefined;
    if (milestone) pack.hierarchy.push(`SUBAREA: ${milestone.title}`);
    if (task) pack.hierarchy.push(`CURRENT TASK: ${task.title}`);
    if (task) {
      sources.push({ store: 'tasks', id: task.id });
      pack.sections.push({
        title: 'Current task',
        lines: [
          task.title,
          `Status: ${task.status}`,
          ...(task.dueAt ? [`Due: ${localDateOfDeadline(task.dueAt)}`] : []),
          ...(task.notes ? [`Notes: ${task.notes}`] : []),
        ],
      });
    }
    if (milestone) {
      sources.push({ store: 'milestones', id: milestone.id });
      const under = data.tasks.filter((t) => t.milestoneId === milestone.id);
      pack.sections.push({
        title: 'Subarea',
        lines: [
          `${milestone.title}${milestone.completedAt ? ' (done)' : ''}${milestone.dueOn ? `, due ${milestone.dueOn}` : ''}`,
          ...under.map((t) => `- [${t.status === 'done' ? 'x' : ' '}] ${t.title}`),
        ],
      });
    }
    pack.sections.push(...projectSections(data, project, today, sources));
    return pack;
  }

  // WORKSPACE (and the base of GLOBAL): every live project, briefly, plus hackathons.
  pack.hierarchy = scope.kind === 'global' ? ['GLOBAL'] : ['GLOBAL', 'WORKSPACE'];
  const live = data.projects.filter((p) => p.state !== 'done' && p.state !== 'archived');
  const lines: string[] = [];
  const needs: string[] = [];
  for (const project of live) {
    sources.push({ store: 'projects', id: project.id });
    const s = summariseProject(
      project,
      data.milestones,
      data.projectItems,
      data.tasks,
      data.workSessions,
      today,
    );
    lines.push(
      `- ${project.name} (${STATE_LABEL[project.state]})${s.completion ? `, ${s.completion.percent}%` : ''}${project.nextAction ? `; next: ${project.nextAction}` : ''} [projects/${project.slug}/]`,
    );
    for (const e of s.lanes.needs_approval) needs.push(`- Approve (${project.name}): ${e.title}`);
    for (const e of s.lanes.blocked) needs.push(`- Blocked (${project.name}): ${e.title}`);
  }
  pack.sections.push({ title: 'Projects', lines: lines.length ? lines : ['No live projects.'] });
  pack.sections.push({ title: 'Needs the owner', lines: needs.length ? needs : ['Nothing.'] });
  const hackathons = data.hackathons.filter(
    (h) => h.status === 'considering' || h.status === 'active',
  );
  for (const h of hackathons) sources.push({ store: 'hackathons', id: h.id });
  pack.sections.push({
    title: 'Hackathons',
    lines: hackathons.length
      ? hackathons.map((h) => {
          const active = hackathonStages(h).find((st) => st.state === 'active');
          return `- ${h.name}${h.eventStart ? ` (${h.eventStart}${h.eventEnd ? ` to ${h.eventEnd}` : ''})` : ''}${active ? `, now: ${STAGE_LABEL[active.key]}` : ''}${h.nextAction ? `; next: ${h.nextAction}` : ''}`;
        })
      : ['None active.'],
  });

  if (scope.kind === 'global') {
    const { grants } = scope;
    pack.granted = (['routines', 'offTime', 'college', 'inbox'] as const).filter((g) => grants[g]);
    const week = startOfWeek(today);
    if (grants.routines) {
      const active = data.habits.filter((h) => !h.archived);
      const logged = data.habitEntries.filter((e) => e.date >= week && e.date <= today);
      pack.sections.push({
        title: 'Routines (granted)',
        lines: active.map(
          (h) =>
            `- ${h.name}: ${logged.filter((e) => e.habitId === h.id).length} day(s) logged this week`,
        ),
      });
    }
    if (grants.offTime) {
      const windows = data.offTimeSessions.filter(
        (o) => o.kind !== 'day_off' && o.endedAt && o.localDate >= addDays(today, -7),
      );
      pack.sections.push({
        title: 'Off time (granted; marked windows, not sleep measurements)',
        lines: windows.map((o) => {
          const minutes = Math.round((Date.parse(o.endedAt!) - Date.parse(o.startedAt!)) / 60_000);
          return `- ${o.localDate} ${o.kind}: ${formatDuration(minutes)} marked`;
        }),
      });
    }
    if (grants.college) {
      const upcoming = data.collegeItems.filter(
        (c) => c.date >= today && c.date <= addDays(today, 14) && c.status === 'planned',
      );
      pack.sections.push({
        title: 'College (granted)',
        lines: upcoming.map(
          (c) => `- ${c.date} ${c.kind}: ${c.title}${c.course ? ` (${c.course})` : ''}`,
        ),
      });
    }
    if (grants.inbox) {
      const open = data.inbox.filter((i) => !i.processedAt);
      pack.sections.push({
        title: 'Inbox (granted)',
        lines: open.map((i) => `- ${i.content.split('\n')[0]}`),
      });
    }
    const worked = data.workSessions
      .filter((s) => s.endedAt && s.localDate >= week)
      .reduce((sum, s) => sum + activeMinutes(s), 0);
    pack.sections.push({
      title: 'This week',
      lines: [`${formatDuration(worked)} of work sessions.`],
    });
  }
  return pack;
}

/** A context pack as Markdown (CONTEXT.md), for coding agents and humans. */
export function renderContextMarkdown(pack: ContextPack): string {
  const out = [
    `<!-- Generated by LOWTIDE ${pack.generatedAt}. Edits here are overwritten on the next export. -->`,
    `# Context: ${pack.hierarchy.at(-1)}`,
    '',
    `Scope: ${pack.hierarchy.join(' > ')}`,
    '',
  ];
  for (const section of pack.sections) {
    out.push(`## ${section.title}`, '');
    out.push(...(section.lines.length ? section.lines : ['None.']), '');
  }
  out.push(
    '---',
    pack.granted.length
      ? `Private areas included by explicit grant: ${pack.granted.join(', ')}. Protected time is never included.`
      : 'Protected time and private life records are never included in LOWTIDE context.',
    '',
  );
  return out.join('\n');
}
