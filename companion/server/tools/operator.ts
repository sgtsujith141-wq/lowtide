import * as z from 'zod/mini';
import { PROJECT_TEMPLATES } from '../../../src/db/project-templates';
import { deadlineFromLocalDate, localDateOfDeadline } from '../../../src/lib/time';
import {
  BUILD_STATUSES,
  HACKATHON_STATUSES,
  PPT_STATUSES,
  PROJECT_FOCUS,
  PROJECT_KINDS,
  PROJECT_STATES,
  REGISTRATION_STATUSES,
  RESEARCH_STATUSES,
  TASK_PRIORITIES,
  type Hackathon,
  type Milestone,
  type Project,
  type ProjectItem,
  type Task,
} from '../../../src/types/domain';
import type { HackathonChanges, TaskChanges } from '../../../src/db/repositories';
import {
  checkDay,
  d,
  dayArg,
  dryRunArg,
  hackathonsInScope,
  limitArg,
  norm,
  op,
  pick,
  projectArg,
  projectOf,
  quote,
  Refusal,
  resolveDecision,
  resolveHackathon,
  resolveItem,
  resolveMilestone,
  resolveTask,
  slugOf,
  taskVisible,
  text,
  visibleProjects,
  type ChangeNote,
  type Env,
  type Tool,
} from './kit';

/*
 * Operator tools (v2.1): everything the owner does to projects, tasks,
 * milestones, decisions, project items and hackathons in the app, done the
 * same way through the domain repositories. Creation is idempotent (an
 * existing match is returned, never "X 2"); references resolve by id, exact
 * title or a unique close match, and ambiguity returns candidates. Each
 * change is recorded for review, with an undo where it can be exact.
 */

const optionalText = (max: number) => z.optional(z.string().check(z.maxLength(max)));
const blank = (v: unknown) => v === '' || v === null;

/* -------------------------------- projects ------------------------------- */

const projectState = z.enum(PROJECT_STATES.filter((s) => s !== 'archived' && s !== 'done'));

function projectJson(_data: { projects: Project[] }, p: Project) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    state: p.state,
    ...(p.focus ? { focus: p.focus } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.objective ? { objective: p.objective } : {}),
    ...(p.phase ? { phase: p.phase } : {}),
    ...(p.nextAction ? { nextAction: p.nextAction } : {}),
    ...(p.pinnedAt ? { pinned: true } : {}),
    updatedAt: p.updatedAt,
  };
}

const PROJECT_FIELDS = [
  'name',
  'description',
  'objective',
  'phase',
  'nextAction',
  'repoUrl',
] as const;

async function createProject(
  env: Env,
  args: Record<string, unknown>,
): Promise<{ created: boolean; result: Record<string, unknown>; changes: ChangeNote[] }> {
  if (env.ctx.grant.scope === 'project') {
    throw new Refusal('Cannot create a project. A project-scoped connection works in one project.');
  }
  const data = await env.data();
  const name = (args.name as string).trim();
  const existing = data.projects.find((p) => norm(p.name) === norm(name));
  if (existing && args.allowDuplicate !== true) {
    return {
      created: false,
      result: {
        existing: true,
        note: 'A project with this name already exists; nothing was created. Pass allowDuplicate to make another.',
        project: projectJson(data, existing),
      },
      changes: [],
    };
  }
  const made = await env.repos().projects.createWithSetup(
    {
      name,
      ...(args.description ? { description: args.description as string } : {}),
      ...(args.kind ? { kind: args.kind as Project['kind'] } : {}),
      state: (args.state as Project['state'] | undefined) ?? 'planning',
      ...(args.objective ? { objective: args.objective as string } : {}),
      ...(args.phase ? { phase: args.phase as string } : {}),
      ...(args.nextAction ? { nextAction: args.nextAction as string } : {}),
      ...(args.repoUrl ? { repoUrl: args.repoUrl as string } : {}),
      ...(args.focus ? { focus: args.focus as Project['focus'] & string } : {}),
    },
    {
      spaceHome: args.spaceHome !== false,
      ...(args.template ? { template: args.template as string } : {}),
      ...(args.templateMilestones ? { templateMilestones: true } : {}),
      ...(args.milestones ? { milestones: args.milestones as string[] } : {}),
    },
  );
  const p = made.project;
  return {
    created: true,
    result: {
      project: projectJson({ projects: [p] }, p),
      ...(made.space
        ? { space: { id: made.space.id, path: `Projects / ${made.space.title}` } }
        : {}),
      milestones: made.milestones.map((m) => ({ id: m.id, title: m.title })),
      pages: made.pages.map((n) => ({ id: n.id, title: n.title, kind: n.kind })),
    },
    changes: [
      {
        summary: `Created project ${p.name}${made.space ? ' with its SPACE folder' : ''}${
          made.milestones.length ? ` and ${made.milestones.length} milestones` : ''
        }`,
        entityType: 'project',
        entityId: p.id,
        // Undo archives it; nothing is ever deleted.
        undo: [op('projects', 'setState', p.id, 'archived')],
        guard: { store: 'projects', id: p.id, fields: { state: p.state } },
      },
    ],
  };
}

const createProjectInput = {
  name: d(text(120), 'The project’s name.'),
  description: d(optionalText(2000), 'What it is, in a sentence or two.'),
  state: d(z.optional(projectState), 'Default planning.'),
  focus: d(z.optional(z.enum(PROJECT_FOCUS)), 'How much attention it gets now.'),
  objective: d(optionalText(2000), 'What “done” means.'),
  phase: d(optionalText(200), 'The current stage in words.'),
  nextAction: optionalText(500),
  kind: z.optional(z.enum(PROJECT_KINDS)),
  repoUrl: optionalText(500),
  spaceHome: d(z.optional(z.boolean()), 'Make its SPACE folder (default true).'),
  template: d(
    z.optional(z.enum(PROJECT_TEMPLATES.map((t) => t.id) as [string, ...string[]])),
    `A project template: ${PROJECT_TEMPLATES.map((t) => `${t.id} (${t.name})`).join(', ')}.`,
  ),
  templateMilestones: d(
    z.optional(z.boolean()),
    'Also make the template’s suggested milestones (never completed).',
  ),
  milestones: d(z.optional(z.array(text(300)).check(z.maxLength(50))), 'Milestones, in order.'),
  allowDuplicate: d(z.optional(z.boolean()), 'Make it even if a project has this name.'),
};

const projectTools: Tool[] = [
  {
    name: 'search_projects',
    title: 'Search projects',
    capability: 'projects.read',
    action: 'search projects',
    description:
      'Projects this connection can see, optionally filtered by words in the name, description or objective, and by state. Archived ones only when asked.',
    write: false,
    input: z.strictObject({
      query: z.optional(text(200)),
      state: z.optional(z.enum(PROJECT_STATES)),
      includeArchived: z.optional(z.boolean()),
    }),
    async run(env, args) {
      const data = await env.data();
      const q = args.query ? norm(args.query as string) : '';
      const list = (await visibleProjects(env)).filter(
        (p) =>
          (args.includeArchived === true || p.state !== 'archived' || args.state === 'archived') &&
          (!args.state || p.state === args.state) &&
          (!q ||
            norm(`${p.name} ${p.slug} ${p.description ?? ''} ${p.objective ?? ''}`).includes(q)),
      );
      return { value: list.map((p) => projectJson(data, p)) };
    },
  },
  {
    name: 'create_project',
    title: 'Create project',
    capability: 'projects.create',
    action: 'create Project',
    dryRun: true,
    description:
      'Creates a project (default state planning) with its SPACE folder, optionally from a template and with milestones, all at once or not at all. If a project with this name exists, returns it instead. Progress comes only from milestones; nothing is ever pre-completed.',
    write: true,
    input: z.strictObject({ ...createProjectInput, dryRun: dryRunArg() }),
    async run(env, args) {
      const { created, result, changes } = await env.atomic(() => createProject(env, args));
      return {
        value: result,
        changes,
        ...(created
          ? {
              entityType: 'project',
              entityId: (result.project as { id: string }).id,
              after: `project ${quote(args.name as string)}`,
            }
          : {}),
      };
    },
  },
  {
    name: 'create_project_from_brief',
    title: 'Create project from a brief',
    capability: ['projects.create', 'space.write'],
    action: 'create Project from a brief',
    dryRun: true,
    description:
      'One call for a whole new project: the project, its SPACE folder, an Overview and a Planning page (and Architecture/Research pages if given) from your Markdown, milestones, first tasks and explicit decisions. All of it or nothing. Returns everything it made.',
    write: true,
    input: z.strictObject({
      ...createProjectInput,
      overview: d(optionalText(100_000), 'Markdown for the Overview page.'),
      planning: d(optionalText(100_000), 'Markdown for the Planning page.'),
      architecture: d(optionalText(100_000), 'Markdown for an Architecture page.'),
      research: d(optionalText(100_000), 'Markdown for a Research page.'),
      tasks: d(
        z.optional(
          z
            .array(z.strictObject({ title: text(300), milestone: z.optional(text(300)) }))
            .check(z.maxLength(100)),
        ),
        'First tasks; milestone by title from `milestones`.',
      ),
      decisions: d(
        z.optional(
          z
            .array(
              z.strictObject({
                title: text(200),
                decision: text(10_000),
                context: z.optional(text(10_000)),
              }),
            )
            .check(z.maxLength(50)),
        ),
        'Decisions that were explicitly made.',
      ),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      return env.atomic(async () => {
        const made = await createProject(env, { ...args, spaceHome: true });
        if (!made.created) return { value: made.result, changes: [] };
        const project = (made.result.project as { id: string; name: string }).id;
        const repos = env.repos();
        const { parseBody } = await import('../../../src/lib/space-blocks');
        const pages: { id: string; title: string }[] = [];
        const slots = [
          ['overview', 'Overview', args.overview],
          ['planning', 'Plan', args.planning],
          ['architecture', 'Architecture', args.architecture],
          ['research', 'Research', args.research],
        ] as const;
        for (const [slot, title, markdown] of slots) {
          if (!markdown) continue;
          const parent = await repos.space.ensureProjectSpace(project, slot);
          const page = await repos.space.create({
            parentId: parent.id,
            title,
            blocks: parseBody(markdown as string),
          });
          pages.push({ id: page.id, title: page.title });
        }
        const milestones = made.result.milestones as { id: string; title: string }[];
        const tasks: { id: string; title: string }[] = [];
        for (const t of (args.tasks as { title: string; milestone?: string }[] | undefined) ?? []) {
          const milestone = t.milestone
            ? milestones.find((m) => norm(m.title) === norm(t.milestone!))
            : undefined;
          if (t.milestone && !milestone)
            throw new Refusal(`No milestone “${t.milestone}” in the brief`);
          const task = await repos.tasks.create({
            title: t.title,
            projectId: project,
            ...(milestone ? { milestoneId: milestone.id } : {}),
          });
          tasks.push({ id: task.id, title: task.title });
        }
        const decisions: { id: string; title: string }[] = [];
        for (const x of (args.decisions as
          { title: string; decision: string; context?: string }[] | undefined) ?? []) {
          const recorded = await repos.projects.recordDecision(project, x);
          decisions.push({ id: recorded.id, title: recorded.title });
        }
        return {
          value: {
            ...made.result,
            pages: [...(made.result.pages as []), ...pages],
            tasks,
            decisions,
          },
          entityType: 'project',
          entityId: project,
          after: `project ${quote(args.name as string)} from a brief`,
          changes: [
            ...made.changes,
            ...(pages.length
              ? [
                  {
                    summary: `Wrote ${pages.length} SPACE pages: ${pages.map((p) => p.title).join(', ')}`,
                  },
                ]
              : []),
            ...(tasks.length ? [{ summary: `Added ${tasks.length} tasks` }] : []),
            ...(decisions.length ? [{ summary: `Recorded ${decisions.length} decisions` }] : []),
          ],
        };
      });
    },
  },
  {
    name: 'create_project_workspace',
    title: 'Create project workspace',
    capability: ['projects.edit', 'space.structure'],
    action: 'create a project workspace',
    description:
      'Makes an existing project’s SPACE folder and its standard sections (Overview, Planning, Research, Architecture, Decisions, Build Plans, Notes, Tables, AI Sessions), or only the sections given. Existing ones are kept.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      sections: d(
        z.optional(
          z.array(
            z.enum([
              'overview',
              'planning',
              'research',
              'architecture',
              'decisions',
              'build-plans',
              'notes',
              'tables',
              'ai-sessions',
            ]),
          ),
        ),
        'Default: overview, planning, research, architecture, decisions.',
      ),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const repos = env.repos();
      const sections = (args.sections as string[] | undefined) ?? [
        'overview',
        'planning',
        'research',
        'architecture',
        'decisions',
      ];
      const made = await env.atomic(async () => {
        const home = await repos.space.ensureProjectSpace(project.id);
        const out = [];
        for (const slot of sections)
          out.push(await repos.space.ensureProjectSpace(project.id, slot as 'overview'));
        return { home, out };
      });
      return {
        value: {
          space: { id: made.home.id, title: made.home.title },
          sections: made.out.map((n) => ({ id: n.id, title: n.title })),
        },
        entityType: 'project',
        entityId: project.id,
        changes: [{ summary: `Set up the SPACE workspace for ${project.name}` }],
      };
    },
  },
  {
    name: 'update_project',
    title: 'Update project',
    capability: 'projects.edit',
    action: 'update a Project',
    dryRun: true,
    description:
      'Changes a project’s name, description, objective, phase (current stage), next action, repository link, focus and/or state. An empty string clears a field; focus "none" clears it. Finishing a project needs every milestone done; archive with archive_project.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      name: z.optional(text(120)),
      description: optionalText(2000),
      objective: optionalText(2000),
      phase: optionalText(200),
      nextAction: optionalText(500),
      repoUrl: optionalText(500),
      focus: z.optional(z.enum([...PROJECT_FOCUS, 'none'])),
      state: z.optional(z.enum(PROJECT_STATES.filter((s) => s !== 'archived'))),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const fields = PROJECT_FIELDS.filter((f) => args[f] !== undefined);
      if (!fields.length && args.state === undefined && args.focus === undefined) {
        throw new Refusal('Nothing to change: give a field, focus or state');
      }
      const repos = env.repos();
      const updated = await env.atomic(async () => {
        let current = project;
        if (fields.length) {
          current = await repos.projects.update(
            project.id,
            Object.fromEntries(fields.map((f) => [f, (args[f] as string) || null])),
          );
        }
        if (args.focus !== undefined) {
          current = await repos.projects.setFocus(
            project.id,
            args.focus === 'none' ? null : (args.focus as Project['focus'] & string),
          );
        }
        if (args.state !== undefined && args.state !== current.state) {
          current = await repos.projects.setState(
            project.id,
            args.state as Exclude<Project['state'], 'archived'>,
          );
        }
        return current;
      });
      const touched = [
        ...fields,
        ...(args.focus !== undefined ? (['focus'] as const) : []),
        ...(args.state !== undefined ? (['state'] as const) : []),
      ];
      const describe = (p: Project) =>
        touched
          .map((f) =>
            f === 'state' || f === 'focus'
              ? `${f}: ${p[f] ?? '(none)'}`
              : `${f}: ${p[f] ? quote(String(p[f])) : '(none)'}`,
          )
          .join('; ');
      const undo = [
        ...(fields.length
          ? [
              op(
                'projects',
                'update',
                project.id,
                Object.fromEntries(fields.map((f) => [f, project[f] ?? null])),
              ),
            ]
          : []),
        ...(args.focus !== undefined
          ? [op('projects', 'setFocus', project.id, project.focus ?? null)]
          : []),
      ];
      // A state change undoes back to the earlier state when LOWTIDE allows that
      // move (never out of Done, which needs every milestone checked again).
      if (args.state !== undefined && project.state !== updated.state && updated.state !== 'done')
        undo.push(op('projects', 'setState', project.id, project.state));
      return {
        value: projectJson({ projects: [updated] }, updated),
        entityType: 'project',
        entityId: project.id,
        before: describe(project),
        after: describe(updated),
        changes: [
          {
            summary: `Updated ${updated.name}: ${touched.join(', ')}`,
            entityType: 'project',
            entityId: project.id,
            ...(undo.length
              ? {
                  undo,
                  guard: {
                    store: 'projects',
                    id: project.id,
                    fields: pick(updated, [
                      ...fields,
                      ...(args.focus !== undefined ? ['focus' as const] : []),
                      ...(args.state !== undefined ? ['state' as const] : []),
                    ]),
                  },
                }
              : {}),
          },
        ],
      };
    },
  },
  {
    name: 'archive_project',
    title: 'Archive project',
    capability: 'projects.archive',
    action: 'archive a Project',
    dryRun: true,
    description:
      'Archives a project: it leaves the active views but stays readable and searchable, with its SPACE folder still linked. Restore with restore_project. Projects are never deleted over MCP.',
    write: true,
    input: z.strictObject({ project: projectArg(), dryRun: dryRunArg() }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      if (project.state === 'archived') throw new Refusal(`${project.name} is already archived`);
      const archived = await env.repos().projects.setState(project.id, 'archived');
      return {
        value: projectJson({ projects: [archived] }, archived),
        entityType: 'project',
        entityId: project.id,
        before: `state: ${project.state}`,
        after: 'state: archived',
        changes: [
          {
            summary: `Archived project ${project.name}`,
            entityType: 'project',
            entityId: project.id,
            undo: [op('projects', 'setState', project.id, 'parked')],
            guard: { store: 'projects', id: project.id, fields: { state: 'archived' } },
          },
        ],
      };
    },
  },
  {
    name: 'restore_project',
    title: 'Restore project',
    capability: 'projects.archive',
    action: 'restore a Project',
    description:
      'Brings an archived project back, as parked (then set its state with update_project).',
    write: true,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      if (project.state !== 'archived') throw new Refusal(`${project.name} isn’t archived`);
      const restored = await env.repos().projects.setState(project.id, 'parked');
      return {
        value: projectJson({ projects: [restored] }, restored),
        entityType: 'project',
        entityId: project.id,
        changes: [
          {
            summary: `Restored project ${project.name} (parked)`,
            entityType: 'project',
            entityId: project.id,
            undo: [op('projects', 'setState', project.id, 'archived')],
            guard: { store: 'projects', id: project.id, fields: { state: 'parked' } },
          },
        ],
      };
    },
  },
  {
    name: 'pin_project',
    title: 'Pin project',
    capability: 'projects.edit',
    action: 'pin a Project',
    description:
      'Pins or unpins a project (only when the owner asks). Pinning never counts as movement.',
    write: true,
    input: z.strictObject({ project: projectArg(), pinned: z.boolean() }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const pinned = args.pinned as boolean;
      await env.repos().projects.setPinned(project.id, pinned);
      return {
        value: { id: project.id, pinned },
        entityType: 'project',
        entityId: project.id,
        changes: [
          {
            summary: `${pinned ? 'Pinned' : 'Unpinned'} project ${project.name}`,
            undo: [op('projects', 'setPinned', project.id, !pinned)],
          },
        ],
      };
    },
  },
];

/* ---------------------------------- tasks -------------------------------- */

function taskJson(data: { projects: Project[] }, t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    ...(t.projectId ? { project: slugOf(data as never, t.projectId) } : {}),
    ...(t.milestoneId ? { milestone: t.milestoneId } : {}),
    ...(t.parentId ? { parent: t.parentId } : {}),
    ...(t.dueAt ? { due: localDateOfDeadline(t.dueAt) } : {}),
    ...(t.plannedFor ? { planned: t.plannedFor } : {}),
    ...(t.completedAt ? { completedAt: t.completedAt } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
  };
}

/** Task changes from tool arguments, resolving milestone and parent refs. */
async function taskChanges(env: Env, task: Task, args: Record<string, unknown>) {
  const changes: TaskChanges = {};
  if (args.title !== undefined) changes.title = args.title as string;
  if (args.notes !== undefined) changes.notes = (args.notes as string) || null;
  if (args.priority !== undefined) changes.priority = args.priority as Task['priority'];
  if (args.due !== undefined)
    changes.dueAt = blank(args.due)
      ? null
      : deadlineFromLocalDate(checkDay(args.due as string, 'due'));
  if (args.milestone !== undefined) {
    changes.milestoneId = blank(args.milestone)
      ? null
      : (await resolveMilestone(env, args.milestone as string, task.projectId)).id;
  }
  if (args.parent !== undefined) {
    changes.parentId = blank(args.parent)
      ? null
      : (await resolveTask(env, args.parent as string, task.projectId)).id;
  }
  return changes;
}

const TASK_FIELDS = [
  'title',
  'notes',
  'priority',
  'dueAt',
  'milestoneId',
  'parentId',
  'projectId',
] as const;

async function applyTaskUpdate(env: Env, task: Task, args: Record<string, unknown>) {
  const repos = env.repos();
  const changes = await taskChanges(env, task, args);
  let current = task;
  if (Object.keys(changes).length) current = await repos.tasks.update(task.id, changes);
  if (args.planned !== undefined) {
    current = blank(args.planned)
      ? await repos.tasks.removeFromPlan(task.id)
      : await repos.tasks.planFor(task.id, checkDay(args.planned as string, 'planned'));
  }
  if (args.status === 'doing' || args.status === 'todo') {
    if (current.status !== args.status)
      current = await repos.tasks.setDoing(task.id, args.status === 'doing');
  }
  const undo = [
    ...(Object.keys(changes).length
      ? [
          op(
            'tasks',
            'update',
            task.id,
            Object.fromEntries(
              (Object.keys(changes) as (keyof TaskChanges)[]).map((k) => [
                k,
                (task as unknown as Record<string, unknown>)[k] ?? null,
              ]),
            ),
          ),
        ]
      : []),
    ...(args.planned !== undefined
      ? [
          task.plannedFor
            ? op('tasks', 'planFor', task.id, task.plannedFor)
            : op('tasks', 'removeFromPlan', task.id),
        ]
      : []),
    ...(args.status !== undefined &&
    task.status !== current.status &&
    (task.status === 'todo' || task.status === 'doing')
      ? [op('tasks', 'setDoing', task.id, task.status === 'doing')]
      : []),
  ];
  return {
    current,
    undo,
    changed: [
      ...Object.keys(changes),
      ...(args.planned !== undefined ? ['planned'] : []),
      ...(args.status !== undefined ? ['status'] : []),
    ],
  };
}

const taskUpdateFields = {
  title: z.optional(text(500)),
  notes: d(optionalText(20_000), 'The description; empty clears it.'),
  priority: z.optional(z.enum(TASK_PRIORITIES)),
  due: dayArg('Deadline'),
  planned: dayArg('The day it’s planned for'),
  status: d(
    z.optional(z.enum(['todo', 'doing'])),
    'Start (doing) or stop (todo). Use complete_task to finish.',
  ),
  milestone: d(
    z.optional(z.string().check(z.maxLength(300))),
    'A milestone of its project (id or title); empty unlinks.',
  ),
  parent: d(
    z.optional(z.string().check(z.maxLength(300))),
    'Make it a subtask of this task (id or title); empty detaches.',
  ),
};

const taskTools: Tool[] = [
  {
    name: 'get_task',
    title: 'Get task',
    capability: 'tasks.read',
    action: 'read a Task',
    description: 'One task in full, with its subtasks and parent.',
    write: false,
    input: z.strictObject({ task: d(text(500), 'Task id or title.'), project: projectArg() }),
    async run(env, args) {
      const data = await env.data();
      const task = await resolveTask(env, args.task as string, args.project as string | undefined);
      return {
        entityType: 'task',
        entityId: task.id,
        value: {
          ...taskJson(data, task),
          createdAt: task.createdAt,
          subtasks: data.tasks.filter((t) => t.parentId === task.id).map((t) => taskJson(data, t)),
        },
      };
    },
  },
  {
    name: 'search_tasks',
    title: 'Search tasks',
    capability: 'tasks.read',
    action: 'search Tasks',
    description: 'Tasks whose title or notes contain every word of the query (open by default).',
    write: false,
    input: z.strictObject({
      query: d(text(200), 'Words to find.'),
      project: projectArg(),
      status: d(z.optional(z.enum(['open', 'closed', 'all'])), 'Default open.'),
      limit: limitArg(30),
    }),
    async run(env, args) {
      const data = await env.data();
      const project = args.project ? await projectOf(env, args.project as string) : undefined;
      const words = norm(args.query as string)
        .split(' ')
        .filter(Boolean);
      const status = (args.status as string | undefined) ?? 'open';
      const out = [];
      for (const t of data.tasks) {
        if (project && t.projectId !== project.id) continue;
        const open = t.status === 'todo' || t.status === 'doing';
        if (status === 'open' ? !open : status === 'closed' ? open : false) continue;
        const hay = norm(`${t.title} ${t.notes ?? ''}`);
        if (!words.every((w) => hay.includes(w))) continue;
        if (!(await taskVisible(env, t))) continue;
        out.push(taskJson(data, t));
        if (out.length >= ((args.limit as number | undefined) ?? 30)) break;
      }
      return { value: out };
    },
  },
  {
    name: 'create_task',
    title: 'Create task',
    capability: 'tasks.create',
    action: 'create a Task',
    dryRun: true,
    description:
      'Creates a task (optionally in a project, under a milestone, or as a subtask of another task). If an open task with the same title already exists there, returns it instead. Never creates completed tasks.',
    write: true,
    input: z.strictObject({
      title: text(500),
      notes: d(optionalText(20_000), 'The description.'),
      project: projectArg(),
      milestone: d(z.optional(text(300)), 'A milestone of the project (id or title).'),
      parent: d(z.optional(text(500)), 'Make it a subtask of this task (id or title).'),
      priority: z.optional(z.enum(TASK_PRIORITIES)),
      due: dayArg('Deadline'),
      planned: dayArg('The day it’s planned for'),
      status: d(z.optional(z.enum(['todo', 'doing'])), 'Default todo.'),
      allowDuplicate: z.optional(z.boolean()),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const data = await env.data();
      const parent = args.parent
        ? await resolveTask(env, args.parent as string, args.project as string | undefined)
        : undefined;
      const project =
        args.project !== undefined || env.ctx.grant.scope === 'project'
          ? await projectOf(env, args.project as string | undefined)
          : parent?.projectId
            ? data.projects.find((p) => p.id === parent.projectId)
            : undefined;
      if (!project && env.ctx.grant.scope !== 'global') {
        throw new Refusal(
          'Name the project: only a global connection keeps tasks outside projects',
        );
      }
      const duplicate = data.tasks.find(
        (t) =>
          (t.status === 'todo' || t.status === 'doing') &&
          norm(t.title) === norm(args.title as string) &&
          (t.projectId ?? null) === (project?.id ?? null) &&
          (t.parentId ?? null) === (parent?.id ?? null),
      );
      if (duplicate && args.allowDuplicate !== true) {
        return {
          value: {
            existing: true,
            note: 'An open task with this title is already there; nothing was created.',
            task: taskJson(data, duplicate),
          },
        };
      }
      const milestone = args.milestone
        ? await resolveMilestone(env, args.milestone as string, project?.id)
        : undefined;
      const repos = env.repos();
      const task = await env.atomic(async () => {
        let t = await repos.tasks.create({
          title: args.title as string,
          ...(args.notes ? { notes: args.notes as string } : {}),
          ...(project ? { projectId: project.id } : {}),
          ...(milestone ? { milestoneId: milestone.id } : {}),
          ...(parent ? { parentId: parent.id } : {}),
          ...(args.priority ? { priority: args.priority as Task['priority'] } : {}),
          ...(args.due
            ? { dueAt: deadlineFromLocalDate(checkDay(args.due as string, 'due')) }
            : {}),
          ...(args.planned ? { plannedFor: checkDay(args.planned as string, 'planned') } : {}),
        });
        if (args.status === 'doing') t = await repos.tasks.setDoing(t.id, true);
        return t;
      });
      return {
        value: taskJson(data, task),
        entityType: 'task',
        entityId: task.id,
        after: `task ${quote(task.title)}`,
        changes: [
          {
            summary: `Added task “${task.title}”${project ? ` to ${project.name}` : ''}${parent ? ` under “${parent.title}”` : ''}`,
            entityType: 'task',
            entityId: task.id,
            undo: [op('tasks', 'drop', task.id)],
            guard: { store: 'tasks', id: task.id, fields: { status: task.status } },
          },
        ],
      };
    },
  },
  {
    name: 'update_task',
    title: 'Update task',
    capability: 'tasks.edit',
    action: 'update a Task',
    dryRun: true,
    description:
      'Changes a task: title, notes, priority, deadline, planned day, milestone, parent, or start/stop it. Empty strings clear optional fields. To move it to another project use move_task; to finish it, complete_task.',
    write: true,
    input: z.strictObject({
      task: d(text(500), 'Task id or title.'),
      project: d(projectArg(), 'Where to look the task up (optional).'),
      ...taskUpdateFields,
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const data = await env.data();
      const task = await resolveTask(env, args.task as string, args.project as string | undefined);
      const { current, undo, changed } = await env.atomic(() => applyTaskUpdate(env, task, args));
      if (!changed.length) throw new Refusal('Nothing to change');
      return {
        value: taskJson(data, current),
        entityType: 'task',
        entityId: task.id,
        changes: [
          {
            summary: `Updated task “${current.title}”: ${changed.join(', ')}`,
            entityType: 'task',
            entityId: task.id,
            undo,
            guard: {
              store: 'tasks',
              id: task.id,
              fields: pick(current, [...TASK_FIELDS, 'status', 'plannedFor']),
            },
          },
        ],
      };
    },
  },
  {
    name: 'update_tasks',
    title: 'Update tasks (several)',
    capability: ['tasks.edit', 'tasks.complete'],
    action: 'update several Tasks',
    dryRun: true,
    checkpointAt: 10,
    description:
      'Changes several tasks in one go, all or nothing; each item is like update_task, plus `complete: true` to finish it. Returns a result per task. Use dryRun to preview.',
    write: true,
    input: z.strictObject({
      tasks: z
        .array(
          z.strictObject({
            task: text(500),
            project: projectArg(),
            ...taskUpdateFields,
            complete: z.optional(z.boolean()),
          }),
        )
        .check(z.minLength(1), z.maxLength(200)),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const data = await env.data();
      const items = args.tasks as Record<string, unknown>[];
      const results = await env.atomic(async () => {
        const out = [];
        for (const item of items) {
          const task = await resolveTask(
            env,
            item.task as string,
            item.project as string | undefined,
          );
          const { current, undo, changed } = await applyTaskUpdate(env, task, item);
          let finished = current;
          if (item.complete === true) finished = await env.repos().tasks.complete(task.id);
          out.push({
            task,
            finished,
            undo,
            changed: [...changed, ...(item.complete ? ['completed'] : [])],
          });
        }
        return out;
      });
      return {
        value: results.map((r) => ({ ...taskJson(data, r.finished), changed: r.changed })),
        changes: results.map((r) => ({
          summary: `Updated task “${r.finished.title}”: ${r.changed.join(', ')}`,
          entityType: 'task',
          entityId: r.task.id,
          ...(r.changed.includes('completed') ? {} : { undo: r.undo }),
        })),
      };
    },
  },
  {
    name: 'complete_task',
    title: 'Complete task',
    capability: 'tasks.complete',
    action: 'complete a Task',
    description: 'Marks an open task done (now; completion times are never back-dated).',
    write: true,
    input: z.strictObject({ task: d(text(500), 'Task id or title.'), project: projectArg() }),
    async run(env, args) {
      const task = await resolveTask(env, args.task as string, args.project as string | undefined);
      const done = await env.repos().tasks.complete(task.id);
      return {
        value: {
          id: done.id,
          title: done.title,
          status: done.status,
          completedAt: done.completedAt,
        },
        entityType: 'task',
        entityId: task.id,
        before: `${quote(task.title)}: ${task.status}`,
        after: `${quote(done.title)}: ${done.status}`,
        changes: [
          {
            summary: `Completed task “${done.title}”`,
            entityType: 'task',
            entityId: task.id,
            undo: [op('tasks', 'reopen', task.id)],
            guard: { store: 'tasks', id: task.id, fields: { status: 'done' } },
          },
        ],
      };
    },
  },
  {
    name: 'reopen_task',
    title: 'Reopen task',
    capability: 'tasks.complete',
    action: 'reopen a Task',
    description: 'Reopens a done or archived (dropped) task as to do.',
    write: true,
    input: z.strictObject({ task: d(text(500), 'Task id or title.'), project: projectArg() }),
    async run(env, args) {
      const task = await resolveTask(env, args.task as string, args.project as string | undefined);
      const reopened = await env.repos().tasks.reopen(task.id);
      return {
        value: taskJson(await env.data(), reopened),
        entityType: 'task',
        entityId: task.id,
        // Completing it again would stamp a new completion time, so no undo.
        changes: [
          { summary: `Reopened task “${task.title}”`, entityType: 'task', entityId: task.id },
        ],
      };
    },
  },
  {
    name: 'move_task',
    title: 'Move task',
    capability: 'tasks.edit',
    action: 'move a Task',
    description:
      'Moves a task to another project (its milestone is cleared unless a new one is given) or out of projects ("none", global connections only), and/or under a milestone or parent task there.',
    write: true,
    input: z.strictObject({
      task: d(text(500), 'Task id or title.'),
      from: d(projectArg(), 'Where to look the task up (optional).'),
      to: d(z.optional(text(200)), 'The project to move it to (id, slug or name), or "none".'),
      milestone: d(z.optional(text(300)), 'A milestone in the destination project.'),
      parent: d(z.optional(text(500)), 'A task in the destination project to put it under.'),
    }),
    async run(env, args) {
      const data = await env.data();
      const task = await resolveTask(env, args.task as string, args.from as string | undefined);
      const destination =
        args.to === undefined
          ? data.projects.find((p) => p.id === task.projectId)
          : args.to === 'none'
            ? undefined
            : await projectOf(env, args.to as string);
      if (args.to === 'none' && env.ctx.grant.scope !== 'global') {
        throw new Refusal('Only a global connection keeps tasks outside projects');
      }
      const changes: TaskChanges = {};
      if (args.to !== undefined) changes.projectId = destination?.id ?? null;
      if (task.parentId && args.parent === undefined && args.to !== undefined)
        changes.parentId = null;
      if (args.milestone !== undefined)
        changes.milestoneId = (
          await resolveMilestone(env, args.milestone as string, destination?.id)
        ).id;
      if (args.parent !== undefined)
        changes.parentId = (await resolveTask(env, args.parent as string, destination?.id)).id;
      if (!Object.keys(changes).length) throw new Refusal('Say where to move it');
      const moved = await env.repos().tasks.update(task.id, changes);
      return {
        value: taskJson(data, moved),
        entityType: 'task',
        entityId: task.id,
        changes: [
          {
            summary: `Moved task “${task.title}”${destination ? ` to ${destination.name}` : ' out of projects'}`,
            entityType: 'task',
            entityId: task.id,
            undo: [
              op('tasks', 'update', task.id, {
                projectId: task.projectId ?? null,
                milestoneId: task.milestoneId ?? null,
                parentId: task.parentId ?? null,
              }),
            ],
            guard: {
              store: 'tasks',
              id: task.id,
              fields: pick(moved, ['projectId', 'milestoneId', 'parentId']),
            },
          },
        ],
      };
    },
  },
  {
    name: 'archive_task',
    title: 'Archive task',
    capability: 'tasks.edit',
    action: 'archive a Task',
    description:
      'Archives an open task (it becomes “dropped”: kept, out of the lists, restorable with restore_task). Tasks are never deleted over MCP.',
    write: true,
    input: z.strictObject({ task: d(text(500), 'Task id or title.'), project: projectArg() }),
    async run(env, args) {
      const task = await resolveTask(env, args.task as string, args.project as string | undefined);
      await env.repos().tasks.drop(task.id);
      return {
        value: { id: task.id, status: 'dropped' },
        entityType: 'task',
        entityId: task.id,
        changes: [
          {
            summary: `Archived task “${task.title}”`,
            entityType: 'task',
            entityId: task.id,
            undo: [op('tasks', 'reopen', task.id)],
            guard: { store: 'tasks', id: task.id, fields: { status: 'dropped' } },
          },
        ],
      };
    },
  },
  {
    name: 'restore_task',
    title: 'Restore task',
    capability: 'tasks.edit',
    action: 'restore a Task',
    description: 'Restores an archived (dropped) task as to do.',
    write: true,
    input: z.strictObject({ task: d(text(500), 'Task id or title.'), project: projectArg() }),
    async run(env, args) {
      const task = await resolveTask(env, args.task as string, args.project as string | undefined);
      if (task.status !== 'dropped') throw new Refusal(`“${task.title}” isn’t archived`);
      await env.repos().tasks.reopen(task.id);
      return {
        value: { id: task.id, status: 'todo' },
        entityType: 'task',
        entityId: task.id,
        changes: [
          {
            summary: `Restored task “${task.title}”`,
            entityType: 'task',
            entityId: task.id,
            undo: [op('tasks', 'drop', task.id)],
            guard: { store: 'tasks', id: task.id, fields: { status: 'todo' } },
          },
        ],
      };
    },
  },
];

/* -------------------------------- milestones ----------------------------- */

const milestoneJson = (m: Milestone) => ({
  id: m.id,
  title: m.title,
  order: m.order,
  weight: m.weight,
  ...(m.dueOn ? { due: m.dueOn } : {}),
  ...(m.notes ? { notes: m.notes } : {}),
  done: m.completedAt !== undefined,
  ...(m.archivedAt ? { archived: true } : {}),
});

const milestoneTools: Tool[] = [
  {
    name: 'create_milestone',
    title: 'Create milestone',
    capability: 'milestones.edit',
    action: 'create a Milestone',
    dryRun: true,
    description:
      'Adds a milestone to a project’s roadmap (last, or at a position counted from 1). If one with this title exists there, returns it. Progress is completed milestone weight over total weight.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(300),
      weight: d(z.optional(z.number().check(z.positive())), 'Default 1.'),
      due: dayArg('Due day'),
      notes: optionalText(10_000),
      position: d(z.optional(z.number().check(z.int(), z.minimum(1))), '1 = first.'),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const data = await env.data();
      const existing = data.milestones.find(
        (m) =>
          m.projectId === project.id &&
          !m.archivedAt &&
          norm(m.title) === norm(args.title as string),
      );
      if (existing) {
        return {
          value: {
            existing: true,
            note: 'A milestone with this title is already on the roadmap; nothing was created.',
            milestone: milestoneJson(existing),
          },
        };
      }
      const m = await env.repos().projects.addMilestone(project.id, {
        title: args.title as string,
        ...(args.weight ? { weight: args.weight as number } : {}),
        ...(args.due ? { dueOn: checkDay(args.due as string, 'due') } : {}),
        ...(args.notes ? { notes: args.notes as string } : {}),
        ...(args.position ? { position: (args.position as number) - 1 } : {}),
      });
      return {
        value: milestoneJson(m),
        entityType: 'milestone',
        entityId: m.id,
        changes: [
          {
            summary: `Added milestone “${m.title}” to ${project.name}`,
            entityType: 'milestone',
            entityId: m.id,
            undo: [op('projects', 'removeMilestone', m.id)],
            guard: { store: 'milestones', id: m.id, fields: { completedAt: null } },
          },
        ],
      };
    },
  },
  {
    name: 'update_milestone',
    title: 'Update milestone',
    capability: 'milestones.edit',
    action: 'update a Milestone',
    description: 'Renames a milestone or changes its weight, due day or notes (empty clears).',
    write: true,
    input: z.strictObject({
      milestone: d(text(300), 'Milestone id or title.'),
      project: projectArg(),
      title: z.optional(text(300)),
      weight: z.optional(z.number().check(z.positive())),
      due: dayArg('Due day'),
      notes: optionalText(10_000),
    }),
    async run(env, args) {
      const m = await resolveMilestone(
        env,
        args.milestone as string,
        args.project as string | undefined,
      );
      const changes: Record<string, unknown> = {};
      if (args.title !== undefined) changes.title = args.title;
      if (args.weight !== undefined) changes.weight = args.weight;
      if (args.due !== undefined)
        changes.dueOn = blank(args.due) ? null : checkDay(args.due as string, 'due');
      if (args.notes !== undefined) changes.notes = (args.notes as string) || null;
      if (!Object.keys(changes).length) throw new Refusal('Nothing to change');
      const updated = await env.repos().projects.updateMilestone(m.id, changes);
      return {
        value: milestoneJson(updated),
        entityType: 'milestone',
        entityId: m.id,
        changes: [
          {
            summary: `Updated milestone “${updated.title}”: ${Object.keys(changes).join(', ')}`,
            entityType: 'milestone',
            entityId: m.id,
            undo: [
              op(
                'projects',
                'updateMilestone',
                m.id,
                Object.fromEntries(
                  Object.keys(changes).map((k) => [
                    k,
                    (m as unknown as Record<string, unknown>)[k] ?? null,
                  ]),
                ),
              ),
            ],
            guard: {
              store: 'milestones',
              id: m.id,
              fields: pick(updated, Object.keys(changes) as (keyof Milestone)[]),
            },
          },
        ],
      };
    },
  },
  {
    name: 'complete_milestone',
    title: 'Complete milestone',
    capability: 'milestones.edit',
    action: 'complete a Milestone',
    description: 'Marks a milestone complete (now), which moves the project’s progress.',
    write: true,
    input: z.strictObject({
      milestone: d(text(300), 'Milestone id or title.'),
      project: projectArg(),
    }),
    async run(env, args) {
      const m = await resolveMilestone(
        env,
        args.milestone as string,
        args.project as string | undefined,
      );
      const done = await env.repos().projects.completeMilestone(m.id);
      return {
        value: { id: done.id, title: done.title, completedAt: done.completedAt },
        entityType: 'milestone',
        entityId: done.id,
        before: `${quote(m.title)}: ${m.completedAt ? 'complete' : 'open'}`,
        after: `${quote(done.title)}: complete`,
        changes: [
          {
            summary: `Completed milestone “${done.title}”`,
            entityType: 'milestone',
            entityId: m.id,
            ...(m.completedAt
              ? {}
              : {
                  undo: [op('projects', 'reopenMilestone', m.id)],
                  guard: {
                    store: 'milestones',
                    id: m.id,
                    fields: { completedAt: done.completedAt },
                  },
                }),
          },
        ],
      };
    },
  },
  {
    name: 'reopen_milestone',
    title: 'Reopen milestone',
    capability: 'milestones.edit',
    action: 'reopen a Milestone',
    description: 'Marks a completed milestone open again.',
    write: true,
    input: z.strictObject({
      milestone: d(text(300), 'Milestone id or title.'),
      project: projectArg(),
    }),
    async run(env, args) {
      const m = await resolveMilestone(
        env,
        args.milestone as string,
        args.project as string | undefined,
      );
      const open = await env.repos().projects.reopenMilestone(m.id);
      return {
        value: milestoneJson(open),
        entityType: 'milestone',
        entityId: m.id,
        changes: [
          { summary: `Reopened milestone “${m.title}”`, entityType: 'milestone', entityId: m.id },
        ],
      };
    },
  },
  {
    name: 'reorder_milestones',
    title: 'Reorder milestones',
    capability: 'milestones.edit',
    action: 'reorder Milestones',
    dryRun: true,
    description:
      'Puts a project’s roadmap in this order. Give every live milestone (id or title), once each. Use dryRun to preview.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      order: z.array(text(300)).check(z.minLength(1), z.maxLength(200)),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const data = await env.data();
      const before = data.milestones
        .filter((m) => m.projectId === project.id && !m.archivedAt)
        .sort((a, b) => a.order - b.order);
      const ids: string[] = [];
      for (const ref of args.order as string[])
        ids.push((await resolveMilestone(env, ref, project.id)).id);
      const ordered = await env.repos().projects.reorderMilestones(project.id, ids);
      return {
        value: ordered.map(milestoneJson),
        entityType: 'project',
        entityId: project.id,
        changes: [
          {
            summary: `Reordered ${project.name}’s roadmap: ${ordered.map((m) => m.title).join(' → ')}`,
            entityType: 'project',
            entityId: project.id,
            undo: [
              op(
                'projects',
                'reorderMilestones',
                project.id,
                before.map((m) => m.id),
              ),
            ],
          },
        ],
      };
    },
  },
  {
    name: 'archive_milestone',
    title: 'Archive milestone',
    capability: 'milestones.edit',
    action: 'archive a Milestone',
    description:
      'Takes a milestone off the roadmap and out of progress, kept with its history; restore_milestone brings it back.',
    write: true,
    input: z.strictObject({
      milestone: d(text(300), 'Milestone id or title.'),
      project: projectArg(),
    }),
    async run(env, args) {
      const m = await resolveMilestone(
        env,
        args.milestone as string,
        args.project as string | undefined,
      );
      await env.repos().projects.archiveMilestone(m.id);
      return {
        value: { id: m.id, archived: true },
        entityType: 'milestone',
        entityId: m.id,
        changes: [
          {
            summary: `Archived milestone “${m.title}”`,
            entityType: 'milestone',
            entityId: m.id,
            undo: [op('projects', 'restoreMilestone', m.id)],
          },
        ],
      };
    },
  },
  {
    name: 'restore_milestone',
    title: 'Restore milestone',
    capability: 'milestones.edit',
    action: 'restore a Milestone',
    description: 'Brings an archived milestone back, at the end of the roadmap.',
    write: true,
    input: z.strictObject({
      milestone: d(text(300), 'Milestone id or title.'),
      project: projectArg(),
    }),
    async run(env, args) {
      const m = await resolveMilestone(
        env,
        args.milestone as string,
        args.project as string | undefined,
        true,
      );
      if (!m.archivedAt) throw new Refusal(`“${m.title}” isn’t archived`);
      await env.repos().projects.restoreMilestone(m.id);
      return {
        value: { id: m.id, archived: false },
        entityType: 'milestone',
        entityId: m.id,
        changes: [
          {
            summary: `Restored milestone “${m.title}”`,
            entityType: 'milestone',
            entityId: m.id,
            undo: [op('projects', 'archiveMilestone', m.id)],
          },
        ],
      };
    },
  },
];

/* -------------------------------- decisions ------------------------------ */

const decisionTools: Tool[] = [
  {
    name: 'record_decision',
    title: 'Record decision',
    capability: 'decisions.write',
    action: 'record a Decision',
    description:
      'Records a decision for a project, attributed to you. Decisions are immutable; to change one, use supersede_decision.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(200),
      decision: text(10_000),
      context: z.optional(text(10_000)),
      consequences: z.optional(text(10_000)),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const x = await env.repos().projects.recordDecision(project.id, {
        title: args.title as string,
        decision: args.decision as string,
        ...(args.context ? { context: args.context as string } : {}),
        ...(args.consequences ? { consequences: args.consequences as string } : {}),
      });
      return {
        value: { id: x.id, title: x.title, decidedAt: x.decidedAt },
        entityType: 'decision',
        entityId: x.id,
        after: `decision ${quote(x.title)} in ${project.slug}`,
        changes: [
          {
            summary: `Recorded decision “${x.title}” in ${project.name}`,
            entityType: 'decision',
            entityId: x.id,
          },
        ],
      };
    },
  },
  {
    name: 'supersede_decision',
    title: 'Supersede decision',
    capability: 'decisions.write',
    action: 'supersede a Decision',
    description:
      'Records a new decision that replaces an earlier one (by id or title). The earlier one is kept as it was, marked superseded; history is never rewritten.',
    write: true,
    input: z.strictObject({
      decision: d(text(300), 'The earlier decision (id or title).'),
      project: projectArg(),
      title: d(z.optional(text(200)), 'Default: the earlier title.'),
      newDecision: text(10_000),
      context: z.optional(text(10_000)),
      consequences: z.optional(text(10_000)),
    }),
    async run(env, args) {
      const earlier = await resolveDecision(
        env,
        args.decision as string,
        args.project as string | undefined,
      );
      const x = await env.repos().projects.recordDecision(earlier.projectId, {
        title: (args.title as string | undefined) ?? earlier.title,
        decision: args.newDecision as string,
        supersedesId: earlier.id,
        ...(args.context ? { context: args.context as string } : {}),
        ...(args.consequences ? { consequences: args.consequences as string } : {}),
      });
      return {
        value: { id: x.id, title: x.title, supersedes: earlier.id },
        entityType: 'decision',
        entityId: x.id,
        changes: [
          {
            summary: `Superseded decision “${earlier.title}” with “${x.title}”`,
            entityType: 'decision',
            entityId: x.id,
          },
        ],
      };
    },
  },
  {
    name: 'get_decision',
    title: 'Get decision',
    capability: 'decisions.read',
    action: 'read a Decision',
    description: 'One decision in full, with what it supersedes and what superseded it.',
    write: false,
    input: z.strictObject({
      decision: d(text(300), 'Decision id or title.'),
      project: projectArg(),
    }),
    async run(env, args) {
      const data = await env.data();
      const x = await resolveDecision(
        env,
        args.decision as string,
        args.project as string | undefined,
      );
      const later = data.decisions.find((y) => y.supersedesId === x.id);
      return {
        entityType: 'decision',
        entityId: x.id,
        value: {
          ...x,
          project: slugOf(data, x.projectId),
          recordedBy: x.origin === 'ai-client' ? (x.client ?? 'AI client') : 'owner',
          ...(later ? { supersededBy: { id: later.id, title: later.title } } : {}),
        },
      };
    },
  },
  {
    name: 'search_decisions',
    title: 'Search decisions',
    capability: 'decisions.read',
    action: 'search Decisions',
    description:
      'Decisions whose title, decision, context or consequences contain every word of the query.',
    write: false,
    input: z.strictObject({ query: text(200), project: projectArg(), limit: limitArg(20) }),
    async run(env, args) {
      const data = await env.data();
      const visible = new Set(
        (await visibleProjects(env, args.project as string | undefined)).map((p) => p.id),
      );
      const words = norm(args.query as string)
        .split(' ')
        .filter(Boolean);
      const superseded = new Set(data.decisions.map((x) => x.supersedesId).filter(Boolean));
      return {
        value: data.decisions
          .filter((x) => visible.has(x.projectId))
          .filter((x) => {
            const hay = norm(`${x.title} ${x.decision} ${x.context ?? ''} ${x.consequences ?? ''}`);
            return words.every((w) => hay.includes(w));
          })
          .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
          .slice(0, (args.limit as number | undefined) ?? 20)
          .map((x) => ({
            id: x.id,
            title: x.title,
            project: slugOf(data, x.projectId),
            decidedAt: x.decidedAt,
            status: superseded.has(x.id) ? 'superseded' : 'accepted',
          })),
      };
    },
  },
];

/* ---------------------------- project items ------------------------------ */

const itemJson = (data: { projects: Project[] }, i: ProjectItem) => ({
  id: i.id,
  project: slugOf(data as never, i.projectId),
  kind: i.kind,
  lane: i.lane,
  title: i.title,
  ...(i.body ? { body: i.body } : {}),
  ...(i.waitingOn ? { waitingOn: i.waitingOn } : {}),
});

/** Adds an item; undo removes it. */
async function addItem(
  env: Env,
  args: Record<string, unknown>,
  input: Parameters<ReturnType<Env['repos']>['projects']['addItem']>[1],
  summary: (project: Project) => string,
) {
  const project = await projectOf(env, args.project as string | undefined);
  const data = await env.data();
  const milestone = args.milestone
    ? await resolveMilestone(env, args.milestone as string, project.id)
    : undefined;
  const task = args.task ? await resolveTask(env, args.task as string, project.id) : undefined;
  const item = await env.repos().projects.addItem(project.id, {
    ...input,
    ...(milestone ? { milestoneId: milestone.id } : {}),
    ...(task ? { taskId: task.id } : {}),
  });
  return {
    value: itemJson(data, item),
    entityType: 'projectItem',
    entityId: item.id,
    after: `${item.kind} ${quote(item.title)} in ${project.slug}`,
    changes: [
      {
        summary: summary(project),
        entityType: 'projectItem',
        entityId: item.id,
        undo: [op('projects', 'removeItem', item.id)],
        guard: { store: 'projectItems', id: item.id, fields: { lane: item.lane } },
      },
    ],
  };
}

/** Resolves an open item; undo reopens it. */
async function resolveOpenItem(env: Env, item: ProjectItem, summary: string) {
  if (item.lane === 'done') throw new Refusal(`“${item.title}” is already resolved`);
  const resolved = await env.repos().projects.resolveItem(item.id);
  return {
    value: { id: resolved.id, title: resolved.title, lane: resolved.lane },
    entityType: 'projectItem',
    entityId: item.id,
    before: `${quote(item.title)}: ${item.lane}`,
    after: `${quote(resolved.title)}: resolved`,
    changes: [
      {
        summary,
        entityType: 'projectItem',
        entityId: item.id,
        undo: [op('projects', 'reopenItem', item.id)],
        guard: { store: 'projectItems', id: item.id, fields: { lane: 'done' } },
      },
    ],
  };
}

const itemRef = () => d(text(300), 'Item id or title.');

const itemTools: Tool[] = [
  {
    name: 'get_blockers',
    title: 'Get blockers',
    capability: 'projects.read',
    action: 'read blockers',
    description: 'Open blockers, for one project or every project this connection can see.',
    write: false,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const data = await env.data();
      const ids = new Set(
        (await visibleProjects(env, args.project as string | undefined)).map((p) => p.id),
      );
      return {
        value: data.projectItems
          .filter((i) => ids.has(i.projectId) && i.kind === 'blocker' && i.lane !== 'done')
          .map((i) => itemJson(data, i)),
      };
    },
  },
  {
    name: 'request_approval',
    title: 'Request approval',
    capability: 'items.edit',
    action: 'request approval',
    description:
      'Asks the owner to approve something. It appears in the project’s Needs approval lane until resolved (or cancelled with cancel_approval).',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(200),
      body: d(z.optional(text(10_000)), 'What exactly needs approving, and why.'),
      milestone: d(z.optional(text(300)), 'A milestone it relates to (id or title).'),
    }),
    run: (env, args) =>
      addItem(
        env,
        args,
        {
          kind: 'approval',
          title: args.title as string,
          ...(args.body ? { body: args.body as string } : {}),
        },
        (p) => `Asked for approval in ${p.name}: “${String(args.title)}”`,
      ),
  },
  {
    name: 'resolve_approval',
    title: 'Resolve approval',
    capability: 'approvals.resolve',
    action: 'resolve an approval',
    description: 'Resolves an open approval request (only with the approvals.resolve permission).',
    write: true,
    input: z.strictObject({ item: itemRef(), project: projectArg() }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        kinds: ['approval'],
      });
      return resolveOpenItem(env, item, `Resolved approval “${item.title}”`);
    },
  },
  {
    name: 'cancel_approval',
    title: 'Cancel approval request',
    capability: 'items.edit',
    action: 'cancel an approval request',
    description:
      'Withdraws an open approval request that’s no longer needed. It is removed, not approved.',
    write: true,
    input: z.strictObject({ item: itemRef(), project: projectArg() }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        kinds: ['approval'],
        open: true,
      });
      await env.repos().projects.removeItem(item.id);
      return {
        value: { id: item.id, cancelled: true },
        entityType: 'projectItem',
        entityId: item.id,
        changes: [
          {
            summary: `Withdrew the approval request “${item.title}”`,
            entityType: 'projectItem',
            entityId: item.id,
          },
        ],
      };
    },
  },
  {
    name: 'create_blocker',
    title: 'Create blocker',
    capability: 'items.edit',
    action: 'create a Blocker',
    description: 'Records something blocking a project (optionally tied to a milestone or task).',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(300),
      body: z.optional(text(10_000)),
      milestone: z.optional(text(300)),
      task: z.optional(text(500)),
    }),
    run: (env, args) =>
      addItem(
        env,
        args,
        {
          kind: 'blocker',
          title: args.title as string,
          ...(args.body ? { body: args.body as string } : {}),
        },
        (p) => `Added a blocker to ${p.name}: “${String(args.title)}”`,
      ),
  },
  {
    name: 'resolve_blocker',
    title: 'Resolve blocker',
    capability: 'items.edit',
    action: 'resolve a Blocker',
    description: 'Marks a blocker resolved.',
    write: true,
    input: z.strictObject({ item: itemRef(), project: projectArg() }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        kinds: ['blocker'],
      });
      return resolveOpenItem(env, item, `Resolved blocker “${item.title}”`);
    },
  },
  {
    name: 'create_waiting',
    title: 'Create waiting item',
    capability: 'items.edit',
    action: 'create a Waiting item',
    description: 'Records that a project is waiting on someone or something.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(300),
      waitingOn: d(text(300), 'Who or what it waits on.'),
      body: z.optional(text(10_000)),
    }),
    run: (env, args) =>
      addItem(
        env,
        args,
        {
          kind: 'dependency',
          lane: 'waiting',
          title: args.title as string,
          waitingOn: args.waitingOn as string,
          ...(args.body ? { body: args.body as string } : {}),
        },
        (p) => `${p.name} is waiting on ${String(args.waitingOn)}: “${String(args.title)}”`,
      ),
  },
  {
    name: 'resolve_waiting',
    title: 'Resolve waiting item',
    capability: 'items.edit',
    action: 'resolve a Waiting item',
    description: 'Marks a waiting item as no longer waiting (resolved).',
    write: true,
    input: z.strictObject({ item: itemRef(), project: projectArg() }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        open: true,
      });
      if (item.lane !== 'waiting') throw new Refusal(`“${item.title}” isn’t waiting`);
      return resolveOpenItem(env, item, `Resolved waiting item “${item.title}”`);
    },
  },
  {
    name: 'add_project_item',
    title: 'Add project item',
    capability: 'items.edit',
    action: 'add a project item',
    description:
      'Adds a focus, step, idea or note to a project’s board, in its default lane or the one given (working_now, next, parked).',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      kind: z.enum(['focus', 'step', 'idea', 'note']),
      title: text(300),
      body: z.optional(text(10_000)),
      lane: z.optional(z.enum(['working_now', 'next', 'parked'])),
      milestone: z.optional(text(300)),
      task: z.optional(text(500)),
    }),
    run: (env, args) =>
      addItem(
        env,
        args,
        {
          kind: args.kind as ProjectItem['kind'],
          title: args.title as string,
          ...(args.lane ? { lane: args.lane as 'next' } : {}),
          ...(args.body ? { body: args.body as string } : {}),
        },
        (p) => `Added ${String(args.kind)} “${String(args.title)}” to ${p.name}`,
      ),
  },
  {
    name: 'update_project_item',
    title: 'Update project item',
    capability: 'items.edit',
    action: 'update a project item',
    description: 'Changes an item’s title, body or what it waits on (empty clears).',
    write: true,
    input: z.strictObject({
      item: itemRef(),
      project: projectArg(),
      title: z.optional(text(300)),
      body: optionalText(10_000),
      waitingOn: optionalText(300),
    }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
      });
      const changes: Record<string, unknown> = {};
      if (args.title !== undefined) changes.title = args.title;
      if (args.body !== undefined) changes.body = (args.body as string) || null;
      if (args.waitingOn !== undefined) changes.waitingOn = (args.waitingOn as string) || null;
      if (!Object.keys(changes).length) throw new Refusal('Nothing to change');
      const updated = await env.repos().projects.updateItem(item.id, changes);
      return {
        value: itemJson(await env.data(), updated),
        entityType: 'projectItem',
        entityId: item.id,
        changes: [
          {
            summary: `Updated “${updated.title}”`,
            entityType: 'projectItem',
            entityId: item.id,
            undo: [
              op(
                'projects',
                'updateItem',
                item.id,
                Object.fromEntries(
                  Object.keys(changes).map((k) => [
                    k,
                    (item as unknown as Record<string, unknown>)[k] ?? null,
                  ]),
                ),
              ),
            ],
          },
        ],
      };
    },
  },
  {
    name: 'move_project_item',
    title: 'Move project item',
    capability: 'items.edit',
    action: 'move a project item',
    description:
      'Moves an open item to another lane (working_now, next, waiting, parked). Open approvals and blockers only leave by being resolved.',
    write: true,
    input: z.strictObject({
      item: itemRef(),
      project: projectArg(),
      lane: z.enum(['working_now', 'next', 'waiting', 'parked']),
      waitingOn: z.optional(text(300)),
    }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        open: true,
      });
      const moved = await env
        .repos()
        .projects.moveItem(item.id, args.lane as 'next', args.waitingOn as string | undefined);
      return {
        value: itemJson(await env.data(), moved),
        entityType: 'projectItem',
        entityId: item.id,
        changes: [
          {
            summary: `Moved “${item.title}” to ${moved.lane.replace('_', ' ')}`,
            entityType: 'projectItem',
            entityId: item.id,
            undo: [op('projects', 'moveItem', item.id, item.lane, item.waitingOn)],
            guard: { store: 'projectItems', id: item.id, fields: { lane: moved.lane } },
          },
        ],
      };
    },
  },
  {
    name: 'park_item',
    title: 'Park item',
    capability: 'items.edit',
    action: 'park an item',
    description:
      'Parks an open project item (not an open approval or blocker), or, given a title instead, records a new idea in the project as parked.',
    write: true,
    input: z.strictObject({
      item: d(z.optional(text(300)), 'The item to park (id or title).'),
      title: d(z.optional(text(300)), 'Or: a new idea to record as parked.'),
      body: z.optional(text(10_000)),
      project: projectArg(),
    }),
    async run(env, args) {
      if (args.item === undefined) {
        if (args.title === undefined)
          throw new Refusal('Name the item to park, or give a title for a new idea');
        return addItem(
          env,
          args,
          {
            kind: 'idea',
            lane: 'parked',
            title: args.title as string,
            ...(args.body ? { body: args.body as string } : {}),
          },
          (p) => `Parked idea “${String(args.title)}” in ${p.name}`,
        );
      }
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        open: true,
      });
      const parked = await env.repos().projects.moveItem(item.id, 'parked');
      return {
        value: { id: parked.id, title: parked.title, lane: parked.lane },
        entityType: 'projectItem',
        entityId: item.id,
        before: `${quote(item.title)}: ${item.lane}`,
        after: `${quote(parked.title)}: parked`,
        changes: [
          {
            summary: `Parked “${item.title}”`,
            entityType: 'projectItem',
            entityId: item.id,
            undo: [op('projects', 'moveItem', item.id, item.lane, item.waitingOn)],
            guard: { store: 'projectItems', id: item.id, fields: { lane: 'parked' } },
          },
        ],
      };
    },
  },
  {
    name: 'resume_item',
    title: 'Resume item',
    capability: 'items.edit',
    action: 'resume an item',
    description: 'Moves a parked item back to Next (default) or Working now.',
    write: true,
    input: z.strictObject({
      item: itemRef(),
      project: projectArg(),
      lane: d(z.optional(z.enum(['next', 'working_now'])), 'Default next.'),
    }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        open: true,
      });
      if (item.lane !== 'parked') throw new Refusal('That item isn’t parked');
      const lane = (args.lane as 'next' | 'working_now' | undefined) ?? 'next';
      const moved = await env.repos().projects.moveItem(item.id, lane);
      return {
        value: { id: moved.id, title: moved.title, lane: moved.lane },
        entityType: 'projectItem',
        entityId: item.id,
        before: `${quote(item.title)}: parked`,
        after: `${quote(moved.title)}: ${moved.lane}`,
        changes: [
          {
            summary: `Resumed “${item.title}” (${moved.lane.replace('_', ' ')})`,
            entityType: 'projectItem',
            entityId: item.id,
            undo: [op('projects', 'moveItem', item.id, 'parked')],
            guard: { store: 'projectItems', id: item.id, fields: { lane: moved.lane } },
          },
        ],
      };
    },
  },
  {
    name: 'archive_item',
    title: 'Archive item',
    capability: 'items.edit',
    action: 'archive an item',
    description:
      'Archives a finished-with idea, note, step or focus by resolving it (kept, out of the board). Approvals, blockers and waiting items have their own resolve tools.',
    write: true,
    input: z.strictObject({ item: itemRef(), project: projectArg() }),
    async run(env, args) {
      const item = await resolveItem(env, args.item as string, {
        project: args.project as string | undefined,
        kinds: ['idea', 'note', 'step', 'focus'],
      });
      return resolveOpenItem(env, item, `Archived “${item.title}”`);
    },
  },
  {
    name: 'move_idea',
    title: 'Move idea',
    capability: ['items.edit', 'space.write'],
    action: 'move an idea',
    description:
      'Moves an idea between a project and the general Ideas section of SPACE: a project’s parked idea becomes a page in Ideas (linked to the project; the item is archived), or an Ideas page becomes a parked idea in a project (the page is archived).',
    write: true,
    input: z.strictObject({
      item: d(z.optional(text(300)), 'A project idea to move to SPACE Ideas.'),
      page: d(z.optional(text(2000)), 'Or: an Ideas page (id or path) to move into a project.'),
      project: projectArg(),
    }),
    async run(env, args) {
      const repos = env.repos();
      if (args.item !== undefined) {
        const item = await resolveItem(env, args.item as string, {
          project: args.project as string | undefined,
          kinds: ['idea'],
        });
        const result = await env.atomic(async () => {
          const ideas =
            (await repos.space.getByKey('ideas')) ??
            (await repos.space.ensureRoots()).find((n) => n.key === 'ideas')!;
          const { parseBody } = await import('../../../src/lib/space-blocks');
          const page = await repos.space.create({
            parentId: ideas.id,
            title: item.title,
            blocks: item.body ? parseBody(item.body) : [],
            links: [{ type: 'project', id: item.projectId }],
          });
          if (item.lane !== 'done') await repos.projects.resolveItem(item.id);
          return page;
        });
        return {
          value: { page: { id: result.id, title: result.title }, archivedItem: item.id },
          entityType: 'spaceNode',
          entityId: result.id,
          changes: [
            {
              summary: `Moved idea “${item.title}” to SPACE Ideas`,
              entityType: 'spaceNode',
              entityId: result.id,
            },
          ],
        };
      }
      if (args.page === undefined)
        throw new Refusal('Give the idea item or the Ideas page to move');
      const { spaceView, resolvePage } = await import('./kit');
      const view = await spaceView(env);
      const page = resolvePage(view, args.page as string);
      if (view.path(page.id)[0]?.key !== 'ideas')
        throw new Refusal('Only pages under Ideas can be moved into a project');
      const project = await projectOf(env, args.project as string | undefined);
      const { blocksOf, blocksToMarkdown } = await import('../../../src/lib/space-blocks');
      const body = blocksToMarkdown(blocksOf(page)).slice(0, 10_000);
      const item = await env.atomic(async () => {
        const made = await repos.projects.addItem(project.id, {
          kind: 'idea',
          lane: 'parked',
          title: page.title.slice(0, 300),
          ...(body.trim() ? { body } : {}),
        });
        await repos.space.archive(page.id);
        return made;
      });
      return {
        value: { item: { id: item.id, title: item.title, lane: item.lane }, archivedPage: page.id },
        entityType: 'projectItem',
        entityId: item.id,
        changes: [
          {
            summary: `Moved idea “${page.title}” into ${project.name} (parked)`,
            entityType: 'projectItem',
            entityId: item.id,
          },
        ],
      };
    },
  },
];

/* -------------------------------- hackathons ----------------------------- */

const hackathonJson = (h: Hackathon) => ({
  id: h.id,
  name: h.name,
  status: h.status,
  ...(h.eventStart ? { start: h.eventStart } : {}),
  ...(h.eventEnd ? { end: h.eventEnd } : {}),
  ...(h.registrationDeadline ? { registrationDeadline: h.registrationDeadline } : {}),
  registration: h.registrationStatus,
  research: h.researchStatus ?? 'not_started',
  ppt: h.pptStatus,
  build: h.buildStatus,
  ...(h.problemStatement ? { problemStatement: h.problemStatement } : {}),
  ...(h.team ? { team: h.team } : {}),
  ...(h.nextAction ? { nextAction: h.nextAction } : {}),
  ...(h.notes ? { notes: h.notes } : {}),
  ...(h.projectId ? { project: h.projectId } : {}),
  ...(h.archivedAt ? { archived: true } : {}),
  ...(h.pinnedAt ? { pinned: true } : {}),
});

const hackathonFields = {
  start: dayArg('Event start'),
  end: dayArg('Event end'),
  registrationDeadline: dayArg('Registration deadline'),
  status: z.optional(z.enum(HACKATHON_STATUSES)),
  registration: z.optional(z.enum(REGISTRATION_STATUSES)),
  research: z.optional(z.enum(RESEARCH_STATUSES)),
  ppt: z.optional(z.enum(PPT_STATUSES)),
  build: z.optional(z.enum(BUILD_STATUSES)),
  problemStatement: optionalText(10_000),
  team: optionalText(1000),
  nextAction: optionalText(1000),
  notes: optionalText(20_000),
};

function hackathonChanges(args: Record<string, unknown>): HackathonChanges {
  const out: Record<string, unknown> = {};
  const dates = {
    start: 'eventStart',
    end: 'eventEnd',
    registrationDeadline: 'registrationDeadline',
  } as const;
  for (const [arg, field] of Object.entries(dates)) {
    if (args[arg] !== undefined)
      out[field] = blank(args[arg]) ? null : checkDay(args[arg] as string, arg);
  }
  const enums = {
    status: 'status',
    registration: 'registrationStatus',
    research: 'researchStatus',
    ppt: 'pptStatus',
    build: 'buildStatus',
  } as const;
  for (const [arg, field] of Object.entries(enums))
    if (args[arg] !== undefined) out[field] = args[arg];
  for (const field of ['problemStatement', 'team', 'nextAction', 'notes'] as const) {
    if (args[field] !== undefined) out[field] = (args[field] as string) || null;
  }
  return out as HackathonChanges;
}

function stageChange(stage: string, state: string, problem?: string): HackathonChanges {
  switch (stage) {
    case 'registration':
      return {
        registrationStatus:
          state === 'done' ? 'registered' : state === 'active' ? 'waitlisted' : 'not_registered',
      };
    case 'problem':
      if (state === 'done' && !problem)
        throw new Refusal('Give the problem statement to mark the problem stage done');
      return { problemStatement: state === 'done' ? problem! : null };
    case 'research':
      return {
        researchStatus:
          state === 'done' ? 'done' : state === 'active' ? 'in_progress' : 'not_started',
      };
    case 'ppt':
      return {
        pptStatus:
          state === 'not_needed'
            ? 'not_needed'
            : state === 'done'
              ? 'submitted'
              : state === 'active'
                ? 'in_progress'
                : 'not_started',
      };
    case 'build':
      return {
        buildStatus:
          state === 'done' ? 'demo_ready' : state === 'active' ? 'in_progress' : 'not_started',
      };
    case 'testing':
      return {
        buildStatus:
          state === 'done' ? 'submitted' : state === 'active' ? 'demo_ready' : 'in_progress',
      };
    case 'submission':
      return { buildStatus: state === 'done' ? 'submitted' : 'demo_ready' };
    default:
      throw new Refusal(`No stage ${stage}`);
  }
}

async function updateHackathon(env: Env, h: Hackathon, changes: HackathonChanges, summary: string) {
  const fields = Object.keys(changes) as (keyof Hackathon)[];
  if (!fields.length) throw new Refusal('Nothing to change');
  const updated = await env.repos().hackathons.update(h.id, changes);
  return {
    value: hackathonJson(updated),
    entityType: 'hackathon',
    entityId: h.id,
    changes: [
      {
        summary,
        entityType: 'hackathon',
        entityId: h.id,
        undo: [
          op(
            'hackathons',
            'update',
            h.id,
            Object.fromEntries(fields.map((f) => [f, h[f] ?? null])),
          ),
        ],
        guard: { store: 'hackathons', id: h.id, fields: pick(updated, fields) },
      },
    ],
  };
}

const hackathonTools: Tool[] = [
  {
    name: 'get_hackathons',
    title: 'Get hackathons',
    capability: 'hackathons.read',
    action: 'read Hackathons',
    description:
      'Hackathons with their dates, stages and next action; one by id or name, or all (archived when asked).',
    write: false,
    input: z.strictObject({
      hackathon: z.optional(text(300)),
      includeArchived: z.optional(z.boolean()),
    }),
    async run(env, args) {
      if (args.hackathon) {
        const h = await resolveHackathon(env, args.hackathon as string);
        return { entityType: 'hackathon', entityId: h.id, value: hackathonJson(h) };
      }
      return {
        value: (await hackathonsInScope(env, args.includeArchived === true)).map(hackathonJson),
      };
    },
  },
  {
    name: 'create_hackathon',
    title: 'Create hackathon',
    capability: 'hackathons.write',
    action: 'create a Hackathon',
    dryRun: true,
    description:
      'Adds a hackathon (default: considering, not registered, nothing started). If one with this name exists, returns it. Example: start 2026-11-04 and nextAction "Research the problem statement".',
    write: true,
    input: z.strictObject({ name: text(200), ...hackathonFields, dryRun: dryRunArg() }),
    async run(env, args) {
      const existing = (await hackathonsInScope(env)).find(
        (h) => norm(h.name) === norm(args.name as string),
      );
      if (existing)
        return {
          value: {
            existing: true,
            note: 'A hackathon with this name exists; nothing was created.',
            hackathon: hackathonJson(existing),
          },
        };
      const changes = hackathonChanges(args) as Record<string, unknown>;
      const input = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null));
      const h = await env.repos().hackathons.create({ name: args.name as string, ...input });
      return {
        value: hackathonJson(h),
        entityType: 'hackathon',
        entityId: h.id,
        changes: [
          {
            summary: `Added hackathon ${h.name}${h.eventStart ? ` (${h.eventStart})` : ''}`,
            entityType: 'hackathon',
            entityId: h.id,
            undo: [op('hackathons', 'archive', h.id)],
          },
        ],
      };
    },
  },
  {
    name: 'update_hackathon',
    title: 'Update hackathon',
    capability: 'hackathons.write',
    action: 'update a Hackathon',
    description:
      'Changes a hackathon’s name, dates, statuses, problem statement, team, next action or notes (empty clears).',
    write: true,
    input: z.strictObject({
      hackathon: d(text(300), 'Id or name.'),
      name: z.optional(text(200)),
      ...hackathonFields,
    }),
    async run(env, args) {
      const h = await resolveHackathon(env, args.hackathon as string);
      const changes = hackathonChanges(args);
      if (args.name !== undefined) (changes as Record<string, unknown>).name = args.name;
      return updateHackathon(
        env,
        h,
        changes,
        `Updated hackathon ${h.name}: ${Object.keys(changes).join(', ')}`,
      );
    },
  },
  {
    name: 'update_hackathon_stage',
    title: 'Update hackathon stage',
    capability: 'hackathons.write',
    action: 'update a Hackathon stage',
    description:
      'Sets one stage of a hackathon’s rail — registration, problem, research, ppt, build, testing or submission — to todo, active or done (ppt also not_needed). Stages are recorded fields, never inferred.',
    write: true,
    input: z.strictObject({
      hackathon: d(text(300), 'Id or name.'),
      stage: z.enum([
        'registration',
        'problem',
        'research',
        'ppt',
        'build',
        'testing',
        'submission',
      ]),
      state: z.enum(['todo', 'active', 'done', 'not_needed']),
      problemStatement: d(optionalText(10_000), 'For the problem stage: the chosen problem.'),
    }),
    async run(env, args) {
      const h = await resolveHackathon(env, args.hackathon as string);
      if (args.state === 'not_needed' && args.stage !== 'ppt')
        throw new Refusal('Only the PPT stage can be not needed');
      const changes = stageChange(
        args.stage as string,
        args.state as string,
        args.problemStatement as string | undefined,
      );
      return updateHackathon(
        env,
        h,
        changes,
        `${h.name}: ${String(args.stage)} stage ${String(args.state).replace('_', ' ')}`,
      );
    },
  },
  {
    name: 'link_hackathon_project',
    title: 'Link hackathon to project',
    capability: ['hackathons.write', 'projects.edit'],
    action: 'link a Hackathon to a Project',
    description:
      'Tracks a hackathon’s build as a project: links an existing project, or with create: true makes one from the hackathon (needs projects.create). project: "none" unlinks.',
    write: true,
    input: z.strictObject({
      hackathon: d(text(300), 'Id or name.'),
      project: d(z.optional(text(200)), 'A project (id, slug or name), or "none" to unlink.'),
      create: z.optional(z.boolean()),
    }),
    async run(env, args) {
      const h = await resolveHackathon(env, args.hackathon as string);
      const repos = env.repos();
      if (args.create === true) {
        env.require('projects.create', 'create Project');
        const project = await repos.projects.createFromHackathon(h.id);
        return {
          value: {
            hackathon: h.id,
            project: { id: project.id, slug: project.slug, name: project.name },
          },
          entityType: 'hackathon',
          entityId: h.id,
          changes: [
            {
              summary: `Made project ${project.name} for hackathon ${h.name}`,
              entityType: 'project',
              entityId: project.id,
            },
          ],
        };
      }
      if (args.project === undefined) throw new Refusal('Name the project, or create: true');
      const project =
        args.project === 'none' ? undefined : await projectOf(env, args.project as string);
      return updateHackathon(
        env,
        h,
        { projectId: project?.id ?? null },
        project
          ? `Linked hackathon ${h.name} to ${project.name}`
          : `Unlinked hackathon ${h.name} from its project`,
      );
    },
  },
  {
    name: 'archive_hackathon',
    title: 'Archive hackathon',
    capability: 'hackathons.write',
    action: 'archive a Hackathon',
    description:
      'Archives a hackathon (kept with everything, out of the lists); restore_hackathon brings it back.',
    write: true,
    input: z.strictObject({ hackathon: d(text(300), 'Id or name.') }),
    async run(env, args) {
      const h = await resolveHackathon(env, args.hackathon as string);
      await env.repos().hackathons.archive(h.id);
      return {
        value: { id: h.id, archived: true },
        entityType: 'hackathon',
        entityId: h.id,
        changes: [
          {
            summary: `Archived hackathon ${h.name}`,
            entityType: 'hackathon',
            entityId: h.id,
            undo: [op('hackathons', 'restore', h.id)],
          },
        ],
      };
    },
  },
  {
    name: 'restore_hackathon',
    title: 'Restore hackathon',
    capability: 'hackathons.write',
    action: 'restore a Hackathon',
    description: 'Brings an archived hackathon back.',
    write: true,
    input: z.strictObject({ hackathon: d(text(300), 'Id or name.') }),
    async run(env, args) {
      const h = await resolveHackathon(env, args.hackathon as string);
      if (!h.archivedAt) throw new Refusal(`${h.name} isn’t archived`);
      await env.repos().hackathons.restore(h.id);
      return {
        value: { id: h.id, archived: false },
        entityType: 'hackathon',
        entityId: h.id,
        changes: [
          {
            summary: `Restored hackathon ${h.name}`,
            entityType: 'hackathon',
            entityId: h.id,
            undo: [op('hackathons', 'archive', h.id)],
          },
        ],
      };
    },
  },
  {
    name: 'pin_hackathon',
    title: 'Pin hackathon',
    capability: 'hackathons.write',
    action: 'pin a Hackathon',
    description: 'Pins or unpins a hackathon (only when the owner asks).',
    write: true,
    input: z.strictObject({ hackathon: d(text(300), 'Id or name.'), pinned: z.boolean() }),
    async run(env, args) {
      const h = await resolveHackathon(env, args.hackathon as string);
      const pinned = args.pinned as boolean;
      await env.repos().hackathons.setPinned(h.id, pinned);
      return {
        value: { id: h.id, pinned },
        changes: [
          {
            summary: `${pinned ? 'Pinned' : 'Unpinned'} hackathon ${h.name}`,
            undo: [op('hackathons', 'setPinned', h.id, !pinned)],
          },
        ],
      };
    },
  },
];

/* --------------------------- sessions, checkpoints ----------------------- */

const sessionTools: Tool[] = [
  {
    name: 'document_project_session',
    title: 'Document project session',
    capability: ['sessions.log', 'space.write'],
    action: 'document a session',
    description:
      'The end-of-session handoff in one call: logs the AI session (summary, changes, commits, tests, blockers, next action) and writes it as a page in the project’s SPACE AI Sessions section. Optionally sets the project’s next action. Factual only; never hidden reasoning.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      summary: d(text(4000), 'What was done, factually.'),
      changes: z.optional(z.array(text(1000)).check(z.maxLength(100))),
      commits: z.optional(z.array(text(200)).check(z.maxLength(100))),
      tests: d(optionalText(4000), 'What was tested and the result.'),
      blockers: z.optional(z.array(text(1000)).check(z.maxLength(50))),
      nextAction: optionalText(1000),
      setProjectNextAction: d(
        z.optional(z.boolean()),
        'Also make nextAction the project’s next action.',
      ),
      handoff: optionalText(10_000),
      title: d(optionalText(200), 'Page title (default: the date and first line of the summary).'),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const repos = env.repos();
      const { parseBody } = await import('../../../src/lib/space-blocks');
      const { toTimestamp } = await import('../../../src/lib/time');
      const lines = (title: string, list?: string[]) =>
        list?.length ? [`## ${title}`, ...list.map((l) => `- ${l}`)] : [];
      const markdown = [
        '## Summary',
        args.summary as string,
        ...lines('Changes', args.changes as string[] | undefined),
        ...lines('Commits', args.commits as string[] | undefined),
        ...(args.tests ? ['## Tests', args.tests as string] : []),
        ...lines('Blockers', args.blockers as string[] | undefined),
        ...(args.nextAction ? ['## Next', args.nextAction as string] : []),
        ...(args.handoff ? ['## Handoff', args.handoff as string] : []),
      ].join('\n');
      const at = toTimestamp(env.at);
      const title =
        (args.title as string | undefined) ||
        `${at.slice(0, 10)} — ${(args.summary as string).split('\n')[0]!.slice(0, 80)}`;
      const result = await env.atomic(async () => {
        const session = await repos.aiSessions.record({
          client: env.ctx.grant.label,
          scope: 'project',
          projectId: project.id,
          startedAt: env.ctx.sessionStartedAt ?? at,
          endedAt: at,
          summary: args.summary as string,
          ...(args.nextAction ? { nextAction: args.nextAction as string } : {}),
          ...(args.commits ? { commits: args.commits as string[] } : {}),
          ...(args.handoff ? { handoff: args.handoff as string } : {}),
          ...(args.tests ? { result: `Tests: ${args.tests as string}`.slice(0, 4000) } : {}),
        });
        const section = await repos.space.ensureProjectSpace(project.id, 'ai-sessions');
        const page = await repos.space.create({
          parentId: section.id,
          title,
          blocks: parseBody(markdown),
          links: [{ type: 'aiSession', id: session.id }],
        });
        if (args.setProjectNextAction && args.nextAction) {
          await repos.projects.update(project.id, { nextAction: args.nextAction as string });
        }
        return { session, page };
      });
      return {
        value: {
          session: result.session.id,
          page: { id: result.page.id, title: result.page.title },
        },
        entityType: 'aiSession',
        entityId: result.session.id,
        changes: [
          {
            summary: `Documented a session for ${project.name}: “${title}”`,
            entityType: 'spaceNode',
            entityId: result.page.id,
          },
        ],
      };
    },
  },
  {
    name: 'create_checkpoint',
    title: 'Create checkpoint',
    capability: 'sessions.log',
    action: 'create a checkpoint',
    description:
      'Takes a named copy of the whole LOWTIDE database the owner can roll back to (before a big reorganisation, say). Large bulk tools take one automatically.',
    write: true,
    input: z.strictObject({ name: text(200) }),
    async run(env, args) {
      if (!env.checkpoints) throw new Refusal('Checkpoints aren’t available on this companion');
      const cp = await env.checkpoints.create(args.name as string, env.ctx.grant.label);
      return { value: cp, changes: [{ summary: `Took checkpoint “${cp.name}”` }] };
    },
  },
];

export const operatorTools: Tool[] = [
  ...projectTools,
  ...taskTools,
  ...milestoneTools,
  ...decisionTools,
  ...itemTools,
  ...hackathonTools,
  ...sessionTools,
];
