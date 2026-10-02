import { useCallback, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Modal } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { PROJECT_TEMPLATES } from '../../db/project-templates';
import type { Watch } from '../../db/repositories';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { deadlineFromLocalDate } from '../../lib/time';
import {
  PROJECT_FOCUS,
  PROJECT_STATES,
  type Id,
  type Milestone,
  type Project,
  type SpaceNode,
} from '../../types/domain';
import { FOCUS_LABEL, STATE_LABEL } from '../projects/summary';
import { HackathonForm } from '../hackathons/HackathonForm';
import {
  CREATE_LABEL,
  CreateContext,
  type CreateDefaults,
  type CreateKind,
} from './create-context';

/*
 * One place to create things (v2.1): the global New menu, the command
 * palette and the pages' own New buttons all open these short forms.
 * Defaults come from where you are: inside a project, a new task belongs to
 * it; inside a SPACE folder, a new page goes there.
 */

const NO_MILESTONES: Watch<Milestone[]> = (onChange) => {
  onChange([]);
  return () => undefined;
};

const LIVE = (p: Project) => p.state !== 'archived' && p.state !== 'done';

/** The project or SPACE place the current screen is about. */
function useHere(projects: Project[], nodes: SpaceNode[]): CreateDefaults {
  const { pathname } = useLocation();
  return useMemo(() => {
    const slug = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
    if (slug) {
      const p = projects.find((x) => x.slug === slug);
      return p ? { projectId: p.id } : {};
    }
    const placeholder = /^\/space\/project\/([^/]+)/.exec(pathname)?.[1];
    if (placeholder) return { projectId: placeholder };
    const nodeId = /^\/space\/([^/]+)/.exec(pathname)?.[1];
    if (nodeId) {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const node = byId.get(nodeId);
      if (!node) return {};
      const parent = node.kind === 'table' ? node.parentId : node.id;
      // The project whose folder it is in, if any.
      let projectId: Id | undefined;
      for (let at: SpaceNode | undefined = node; at; at = byId.get(at.parentId ?? '')) {
        const m = /^project:([^:]+)$/.exec(at.key ?? '');
        if (m) projectId = m[1];
      }
      return { ...(parent ? { parentId: parent } : {}), ...(projectId ? { projectId } : {}) };
    }
    return {};
  }, [pathname, projects, nodes]);
}

export function CreateProvider({ children }: { children: ReactNode }) {
  const { projects, space } = useRepositories();
  const all = useWatch(projects.watchAll);
  const allNodes = useWatch(space.watchAll);
  const projectList = useMemo(() => (all.status === 'ready' ? all.data : []), [all]);
  const nodes = useMemo(() => (allNodes.status === 'ready' ? allNodes.data : []), [allNodes]);
  const here = useHere(projectList, nodes);
  const [open, setOpen] = useState<{ kind: CreateKind; defaults: CreateDefaults } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const openCreate = useCallback(
    (kind: CreateKind, defaults?: CreateDefaults) =>
      setOpen({ kind, defaults: { ...here, ...defaults } }),
    [here],
  );
  const api = useMemo(() => ({ openCreate }), [openCreate]);
  const close = () => setOpen(null);
  const done = (message: string) => {
    setOpen(null);
    setAnnouncement(message);
    setTimeout(() => setAnnouncement(''), 6000);
  };

  return (
    <CreateContext value={api}>
      {children}
      <Modal
        open={open !== null}
        onClose={close}
        title={open ? `New ${CREATE_LABEL[open.kind].toLowerCase()}` : 'New'}
        wide={open?.kind === 'project'}
      >
        {open && (
          <CreateForm
            kind={open.kind}
            defaults={open.defaults}
            projects={projectList.filter(LIVE)}
            nodes={nodes}
            onCancel={close}
            onDone={done}
          />
        )}
      </Modal>
      {announcement && <Announcer message={announcement} />}
    </CreateContext>
  );
}

interface FormProps {
  defaults: CreateDefaults;
  projects: Project[];
  nodes: SpaceNode[];
  onCancel: () => void;
  onDone: (message: string) => void;
}

function CreateForm({ kind, ...props }: FormProps & { kind: CreateKind }) {
  switch (kind) {
    case 'task':
      return <TaskForm {...props} />;
    case 'project':
      return <ProjectForm {...props} />;
    case 'page':
    case 'folder':
    case 'database':
      return <SpaceForm kind={kind} {...props} />;
    case 'hackathon':
      return <HackathonCreate {...props} />;
    case 'idea':
      return <IdeaForm {...props} />;
    case 'decision':
      return <DecisionForm {...props} />;
  }
}

/* --------------------------------- pieces -------------------------------- */

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : 'Couldn’t create that. Nothing changed.',
      );
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-[11px] text-fg-muted">{hint}</p>}
    </div>
  );
}

function Actions({
  busy,
  label,
  onCancel,
}: {
  busy: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Creating…' : label}
      </Button>
    </div>
  );
}

function ProjectSelect({
  id,
  projects,
  value,
  onChange,
  none = 'No project',
}: {
  id: string;
  projects: Project[];
  value: string;
  onChange: (v: string) => void;
  none?: string | null;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
      {none !== null && <option value="">{none}</option>}
      {projects
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

/* ---------------------------------- forms -------------------------------- */

function TaskForm({ defaults, projects, onCancel, onDone }: FormProps) {
  const { tasks, projects: projectRepo } = useRepositories();
  const [title, setTitle] = useState(defaults.title ?? '');
  const [projectId, setProjectId] = useState(defaults.projectId ?? '');
  const [milestoneId, setMilestoneId] = useState('');
  const [due, setDue] = useState('');
  const watchMilestones = useMemo(
    () => (projectId ? projectRepo.watchMilestones(projectId) : null),
    [projectRepo, projectId],
  );
  const milestones = useWatch(watchMilestones ?? NO_MILESTONES);
  const { busy, error, submit } = useSubmit(async () => {
    if (!title.trim()) {
      throw new Error('Give the task a title.');
    }
    const task = await tasks.create({
      title,
      ...(projectId ? { projectId } : {}),
      ...(milestoneId ? { milestoneId } : {}),
      ...(due ? { dueAt: deadlineFromLocalDate(due) } : {}),
    });
    onDone(`Added task ${task.title}.`);
  });
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="New task" className="space-y-3" noValidate>
      <Field label="Title">
        {(id) => (
          <input
            id={id}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
            placeholder="What needs doing?"
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project">
          {(id) => (
            <ProjectSelect
              id={id}
              projects={projects}
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setMilestoneId('');
              }}
            />
          )}
        </Field>
        <Field label="Due (optional)">
          {(id) => (
            <input
              id={id}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className={fieldClass}
            />
          )}
        </Field>
      </div>
      {projectId && milestones.status === 'ready' && milestones.data.length > 0 && (
        <Field label="Milestone (optional)">
          {(id) => (
            <select
              id={id}
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              className={fieldClass}
            >
              <option value="">None</option>
              {milestones.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Actions busy={busy} label="Add task" onCancel={onCancel} />
    </form>
  );
}

function ProjectForm({ defaults, onCancel, onDone }: FormProps) {
  const { projects } = useRepositories();
  const navigate = useNavigate();
  const [name, setName] = useState(defaults.title ?? '');
  const [purpose, setPurpose] = useState('');
  const [state, setState] = useState<Project['state']>('planning');
  const [focus, setFocus] = useState('');
  const [objective, setObjective] = useState('');
  const [firstMilestone, setFirstMilestone] = useState('');
  const [template, setTemplate] = useState('');
  const [spaceHome, setSpaceHome] = useState(true);
  const { busy, error, submit } = useSubmit(async () => {
    if (!name.trim()) {
      throw new Error('Name the project.');
    }
    const made = await projects.createWithSetup(
      {
        name,
        state,
        ...(purpose.trim() ? { description: purpose } : {}),
        ...(objective.trim() ? { objective } : {}),
        ...(focus ? { focus: focus as Project['focus'] & string } : {}),
      },
      {
        spaceHome,
        ...(template ? { template } : {}),
        ...(firstMilestone.trim() ? { milestones: [firstMilestone.trim()] } : {}),
      },
    );
    onDone(`Created project ${made.project.name}.`);
    void navigate(`/projects/${made.project.slug}`);
  });
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="New project"
      className="space-y-3"
      noValidate
    >
      <Field label="Name">
        {(id) => (
          <input
            id={id}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <Field label="Purpose" hint="What it is, in a sentence or two.">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="State">
          {(id) => (
            <select
              id={id}
              value={state}
              onChange={(e) => setState(e.target.value as Project['state'])}
              className={fieldClass}
            >
              {PROJECT_STATES.filter((s) => s !== 'archived' && s !== 'done').map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Priority">
          {(id) => (
            <select
              id={id}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className={fieldClass}
            >
              <option value="">Not set</option>
              {PROJECT_FOCUS.map((f) => (
                <option key={f} value={f}>
                  {FOCUS_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={spaceHome}
          onChange={(e) => setSpaceHome(e.target.checked)}
          className="size-4"
        />
        Create its SPACE folder
      </label>
      <details className="rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm text-fg-muted select-none hover:text-fg">
          More options
        </summary>
        <div className="mt-3 space-y-3">
          <Field label="Objective" hint="What “done” means.">
            {(id) => (
              <input
                id={id}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className={fieldClass}
              />
            )}
          </Field>
          <Field label="First milestone">
            {(id) => (
              <input
                id={id}
                value={firstMilestone}
                onChange={(e) => setFirstMilestone(e.target.value)}
                className={fieldClass}
              />
            )}
          </Field>
          <Field
            label="Template"
            hint="Sets up SPACE sections and starting pages. Never adds progress."
          >
            {(id) => (
              <select
                id={id}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className={fieldClass}
              >
                <option value="">None</option>
                {PROJECT_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </details>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Actions busy={busy} label="Create project" onCancel={onCancel} />
    </form>
  );
}

/** Folders and pages a new SPACE item can go in, with their paths. */
function useContainers(nodes: SpaceNode[]) {
  return useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const path = (n: SpaceNode) => {
      const parts: string[] = [];
      for (let at: SpaceNode | undefined = n; at; at = byId.get(at.parentId ?? ''))
        parts.unshift(at.title);
      return parts.join(' / ');
    };
    const archivedAbove = (n: SpaceNode) => {
      for (let at: SpaceNode | undefined = n; at; at = byId.get(at.parentId ?? ''))
        if (at.archived) return true;
      return false;
    };
    return nodes
      .filter((n) => n.kind !== 'table' && !archivedAbove(n))
      .map((n) => ({ id: n.id, label: path(n), kind: n.kind, key: n.key }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes]);
}

function SpaceForm({
  kind,
  defaults,
  projects,
  nodes,
  onCancel,
  onDone,
}: FormProps & { kind: 'page' | 'folder' | 'database' }) {
  const { space } = useRepositories();
  const navigate = useNavigate();
  const containers = useContainers(nodes);
  const ideas = nodes.find((n) => n.key === 'ideas');
  const projectFolder = defaults.projectId
    ? nodes.find((n) => n.key === `project:${defaults.projectId}`)
    : undefined;
  const [title, setTitle] = useState(defaults.title ?? '');
  const [parentId, setParentId] = useState(
    defaults.parentId ?? projectFolder?.id ?? ideas?.id ?? containers[0]?.id ?? '',
  );
  const project = defaults.projectId
    ? projects.find((p) => p.id === defaults.projectId)
    : undefined;
  // Templates live in LOWTIDE / Templates; pages for pages, databases for databases.
  const templatesFolder = nodes.find((n) => n.key === 'lowtide:templates');
  const templates = templatesFolder
    ? nodes.filter(
        (n) =>
          n.parentId === templatesFolder.id &&
          !n.archived &&
          n.kind === (kind === 'database' ? 'table' : 'page'),
      )
    : [];
  const [template, setTemplate] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    let parent = parentId;
    if (!parent && project) parent = (await space.ensureProjectSpace(project.id)).id;
    if (!parent) parent = (await space.ensureRoots()).find((n) => n.key === 'ideas')!.id;
    const name = title.trim() || (kind === 'folder' ? 'New folder' : 'Untitled');
    if (kind === 'folder' && !title.trim()) {
      throw new Error('Name the folder.');
    }
    if (template && kind !== 'folder') {
      const made = await space.applyTemplate(template, parent, title.trim() || undefined);
      onDone(`Created ${made.title} from a template.`);
      void navigate(`/space/${made.id}`);
      return;
    }
    const node = await space.create({
      parentId: parent,
      title: name,
      ...(kind === 'folder' ? { kind: 'section' as const } : {}),
      ...(kind === 'page' ? { blocks: [] } : {}),
      ...(kind === 'database'
        ? {
            table: {
              columns: [
                { id: 'name', name: 'Name', type: 'text' as const },
                {
                  id: 'status',
                  name: 'Status',
                  type: 'status' as const,
                  options: [{ name: 'Not started' }, { name: 'In progress' }, { name: 'Done' }],
                },
              ],
              rows: [],
            },
          }
        : {}),
    });
    onDone(`Created ${kind === 'database' ? 'database' : kind} ${node.title}.`);
    void navigate(`/space/${node.id}`);
  });
  const what = kind === 'database' ? 'database' : kind;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label={`New ${what}`}
      className="space-y-3"
      noValidate
    >
      <Field label={kind === 'folder' ? 'Folder name' : 'Title'}>
        {(id) => (
          <input
            id={id}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'folder' ? 'Research' : 'Untitled'}
            className={fieldClass}
          />
        )}
      </Field>
      <Field label="In">
        {(id) => (
          <select
            id={id}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className={fieldClass}
          >
            {!parentId && project && (
              <option value="">{`Projects / ${project.name} (made now)`}</option>
            )}
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {kind !== 'folder' && templates.length > 0 && (
        <Field label="Start from">
          {(id) => (
            <select
              id={id}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className={fieldClass}
            >
              <option value="">{kind === 'database' ? 'Name and Status' : 'A blank page'}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {kind === 'database' && !template && (
        <p className="text-xs text-fg-muted">
          It starts with Name and Status; add properties and views in the database.
        </p>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Actions busy={busy} label={`Create ${what}`} onCancel={onCancel} />
    </form>
  );
}

function HackathonCreate({ defaults, onCancel, onDone }: FormProps) {
  const { hackathons } = useRepositories();
  const navigate = useNavigate();
  return (
    <HackathonForm
      initial={defaults.title ? { name: defaults.title } : {}}
      quick
      formLabel="Add hackathon"
      submitLabel="Add"
      onSave={async (draft) => {
        const h = await hackathons.create({
          name: draft.name,
          ...(draft.eventStart ? { eventStart: draft.eventStart } : {}),
          ...(draft.eventEnd ? { eventEnd: draft.eventEnd } : {}),
        });
        onDone(`Added hackathon ${h.name}.`);
        void navigate('/hackathons', { state: { open: h.id } });
      }}
      onCancel={onCancel}
    />
  );
}

function IdeaForm({ defaults, projects, nodes, onCancel, onDone }: FormProps) {
  const { space, projects: projectRepo } = useRepositories();
  const navigate = useNavigate();
  const [title, setTitle] = useState(defaults.title ?? '');
  const [note, setNote] = useState('');
  const [where, setWhere] = useState(defaults.projectId ?? '');
  const { busy, error, submit } = useSubmit(async () => {
    if (!title.trim()) {
      throw new Error('Say what the idea is.');
    }
    if (where) {
      const item = await projectRepo.addItem(where, {
        kind: 'idea',
        lane: 'parked',
        title,
        ...(note.trim() ? { body: note } : {}),
      });
      onDone(`Parked idea ${item.title}.`);
      return;
    }
    const ideas =
      nodes.find((n) => n.key === 'ideas') ??
      (await space.ensureRoots()).find((n) => n.key === 'ideas')!;
    const page = await space.create({
      parentId: ideas.id,
      title,
      blocks: note.trim() ? [{ type: 'paragraph', text: note }] : [],
    });
    onDone(`Saved idea ${page.title} in SPACE.`);
    void navigate(`/space/${page.id}`);
  });
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="New idea" className="space-y-3" noValidate>
      <Field label="Idea">
        {(id) => (
          <input
            id={id}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <Field label="Note (optional)">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <Field label="Keep it in" hint="SPACE Ideas, or parked in a project.">
        {(id) => (
          <ProjectSelect
            id={id}
            projects={projects}
            value={where}
            onChange={setWhere}
            none="SPACE → Ideas"
          />
        )}
      </Field>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Actions busy={busy} label="Save idea" onCancel={onCancel} />
    </form>
  );
}

function DecisionForm({ defaults, projects, onCancel, onDone }: FormProps) {
  const { projects: projectRepo } = useRepositories();
  const [projectId, setProjectId] = useState(defaults.projectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState(defaults.title ?? '');
  const [decision, setDecision] = useState('');
  const [context, setContext] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    if (!projectId || !title.trim() || !decision.trim()) {
      throw new Error('Choose the project, and give the decision a title and the decision itself.');
    }
    const x = await projectRepo.recordDecision(projectId, {
      title,
      decision,
      ...(context.trim() ? { context } : {}),
    });
    onDone(`Recorded decision ${x.title}.`);
  });
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="New decision"
      className="space-y-3"
      noValidate
    >
      <Field label="Project">
        {(id) => (
          <ProjectSelect
            id={id}
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            none={null}
          />
        )}
      </Field>
      <Field label="Title">
        {(id) => (
          <input
            id={id}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <Field label="Decision">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <Field label="Why (optional)">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className={fieldClass}
          />
        )}
      </Field>
      <p className="text-xs text-fg-muted">
        Decisions are kept as recorded; a later one can supersede it.
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Actions busy={busy} label="Record decision" onCancel={onCancel} />
    </form>
  );
}
