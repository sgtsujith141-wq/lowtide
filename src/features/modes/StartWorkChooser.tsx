import { Briefcase, GraduationCap, Play } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { ErrorNotice } from '../../components/ui/Notice';
import type { StartWork } from '../../db/repositories';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { addDays } from '../../lib/calendar';
import type { Id, Project, Task } from '../../types/domain';
import { FOCUS_RANK, withoutProjectPrefix } from '../home/model';
import { indexNodes, projectIdOf } from '../space/model';
import type { StartDefaults } from './mode-context';

/*
 * Start Work (v2 PHASE 015): a fast chooser, not a form. Type to narrow,
 * arrows to move, Enter to start. What the current page is about comes
 * first (the Command Room's project, a task, a SPACE page's project), then
 * recent work, then every live project, then general work and study.
 */

interface Option {
  key: string;
  group: string;
  label: string;
  detail?: string;
  input: StartWork;
}

function useContextProject(
  defaults: StartDefaults | undefined,
  projects: Project[],
): Id | undefined {
  const { space } = useRepositories();
  const { pathname } = useLocation();
  const nodes = useWatch(space.watchAll);
  if (defaults?.projectId) return defaults.projectId;
  const room = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
  if (room) return projects.find((p) => p.slug === room)?.id;
  const page = /^\/space\/(?!project\/)([^/]+)/.exec(pathname)?.[1] ?? undefined;
  if (page && nodes.status === 'ready') return projectIdOf(indexNodes(nodes.data), page);
  const placeholder = /^\/space\/project\/([^/]+)/.exec(pathname)?.[1];
  return placeholder;
}

export function StartWorkChooser({
  defaults,
  onStart,
  onCancel,
}: {
  defaults: StartDefaults | undefined;
  onStart: (input: StartWork) => Promise<void>;
  onCancel: () => void;
}) {
  const { projects, tasks, work } = useRepositories();
  const today = useToday();
  const all = useWatch(projects.watchAll);
  const open = useWatch(tasks.watchOpen);
  const recentWatch = useMemo(() => work.watchRange(addDays(today, -30), today), [work, today]);
  const recent = useWatch(recentWatch);
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = { q: useId(), intent: useId() };
  const input = useRef<HTMLInputElement>(null);

  const live = useMemo(
    () =>
      (all.status === 'ready' ? all.data : [])
        .filter((p) => p.state !== 'done' && p.state !== 'archived')
        .sort(
          (a, b) =>
            FOCUS_RANK[a.focus ?? 'unset'] - FOCUS_RANK[b.focus ?? 'unset'] ||
            a.name.localeCompare(b.name),
        ),
    [all],
  );
  const contextId = useContextProject(defaults, live);
  const openTasks = useMemo(() => (open.status === 'ready' ? open.data : []), [open]);

  const options = useMemo<Option[]>(() => {
    const byId = new Map(live.map((p) => [p.id, p]));
    const projectOption = (p: Project, group: string): Option => ({
      key: `${group}:p:${p.id}`,
      group,
      label: p.name,
      detail: 'Project',
      input: { kind: 'project', projectId: p.id },
    });
    const taskOption = (t: Task, group: string): Option => {
      const p = t.projectId ? byId.get(t.projectId) : undefined;
      return {
        key: `${group}:t:${t.id}`,
        group,
        label: withoutProjectPrefix(t.title, p?.name),
        detail: p ? `${p.name} · task` : 'Task',
        input: { kind: 'task', taskId: t.id },
      };
    };
    const general: Option[] = [
      { key: 'g:general', group: 'General', label: 'General work', input: { kind: 'general' } },
      { key: 'g:college', group: 'General', label: 'College / study', input: { kind: 'college' } },
    ];
    const q = query.trim().toLowerCase();
    if (q) {
      const hit = (o: Option) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q);
      return [
        ...live.map((p) => projectOption(p, 'Projects')).filter(hit),
        ...openTasks
          .map((t) => taskOption(t, 'Tasks'))
          .filter(hit)
          .slice(0, 12),
        ...general.filter(hit),
      ];
    }
    const out: Option[] = [];
    const context = contextId ? byId.get(contextId) : undefined;
    if (context) {
      out.push(projectOption(context, context.name));
      const mine = openTasks
        .filter((t) => t.projectId === context.id)
        .sort((a, b) => (a.status === 'doing' ? 0 : 1) - (b.status === 'doing' ? 0 : 1));
      for (const t of mine.slice(0, 6)) out.push(taskOption(t, context.name));
      if (defaults?.taskId && !mine.slice(0, 6).some((t) => t.id === defaults.taskId)) {
        const t = openTasks.find((x) => x.id === defaults.taskId);
        if (t) out.push(taskOption(t, context.name));
      }
    }
    // Recent: the last distinct things worked on, newest first.
    const seen = new Set(out.map((o) => JSON.stringify(o.input)));
    const recents = (recent.status === 'ready' ? recent.data : [])
      .filter((s) => s.endedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const s of recents) {
      if (out.filter((o) => o.group === 'Recent').length >= 4) break;
      const inputFor: StartWork | undefined =
        s.kind === 'task' && s.taskId && openTasks.some((t) => t.id === s.taskId)
          ? { kind: 'task', taskId: s.taskId }
          : s.projectId && byId.has(s.projectId)
            ? { kind: 'project', projectId: s.projectId }
            : s.kind === 'general' || s.kind === 'college'
              ? { kind: s.kind }
              : undefined;
      if (!inputFor || seen.has(JSON.stringify(inputFor))) continue;
      seen.add(JSON.stringify(inputFor));
      const t = inputFor.taskId ? openTasks.find((x) => x.id === inputFor.taskId) : undefined;
      const p = inputFor.projectId ? byId.get(inputFor.projectId) : undefined;
      out.push(
        t
          ? taskOption(t, 'Recent')
          : p
            ? projectOption(p, 'Recent')
            : {
                ...general.find((g) => g.input.kind === inputFor.kind)!,
                key: `r:${inputFor.kind}`,
                group: 'Recent',
              },
      );
    }
    for (const p of live) {
      if (seen.has(JSON.stringify({ kind: 'project', projectId: p.id }))) continue;
      out.push(projectOption(p, 'Projects'));
    }
    return [...out, ...general.filter((g) => !seen.has(JSON.stringify(g.input)))];
  }, [query, live, openTasks, recent, contextId, defaults]);

  // Preselect the task asked for, else the first choice.
  const preselect = defaults?.taskId
    ? Math.max(
        0,
        options.findIndex((o) => o.input.taskId === defaults.taskId),
      )
    : 0;
  const [touched, setTouched] = useState(false);
  const current = Math.min(touched ? active : preselect, Math.max(0, options.length - 1));

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function start(o: Option | undefined) {
    if (!o || busy) return;
    setBusy(true);
    setError(false);
    try {
      await onStart({ ...o.input, ...(intent.trim() ? { intent: intent.trim() } : {}) });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  const groups: [string, Option[]][] = [];
  for (const o of options) {
    const last = groups.at(-1);
    if (last && last[0] === o.group) last[1].push(o);
    else groups.push([o.group, [o]]);
  }
  let index = -1;

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      className="p-3"
    >
      <p className="px-1 pb-2 text-xs font-medium text-fg-muted">Start work</p>
      <label htmlFor={ids.q} className="sr-only">
        What are you working on?
      </label>
      <input
        id={ids.q}
        ref={input}
        role="combobox"
        aria-expanded
        aria-controls={`${ids.q}-list`}
        aria-activedescendant={options[current] ? `${ids.q}-${current}` : undefined}
        autoComplete="off"
        value={query}
        placeholder="What are you working on?"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setTouched(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setTouched(true);
            const n = Math.max(1, options.length);
            setActive((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void start(options[current]);
          }
        }}
        className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-[15px]"
      />
      <ul
        id={`${ids.q}-list`}
        role="listbox"
        aria-label="Choices"
        className="mt-2 max-h-[min(52vh,26rem)] overflow-y-auto"
        tabIndex={-1}
      >
        {options.length === 0 && (
          <li className="px-2 py-3 text-sm text-fg-muted">Nothing matches.</li>
        )}
        {groups.map(([group, list]) => (
          <li key={group} role="presentation">
            <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-fg-muted">{group}</p>
            <ul role="group" aria-label={group}>
              {list.map((o) => {
                index += 1;
                const i = index;
                const Icon =
                  o.input.kind === 'college'
                    ? GraduationCap
                    : o.input.kind === 'general'
                      ? Briefcase
                      : Play;
                return (
                  <li
                    key={o.key}
                    id={`${ids.q}-${i}`}
                    role="option"
                    aria-selected={i === current}
                    onMouseMove={() => {
                      setTouched(true);
                      setActive(i);
                    }}
                    onClick={() => void start(o)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm ${i === current ? 'bg-hover' : ''}`}
                  >
                    <Icon
                      aria-hidden
                      className={`size-3.5 shrink-0 ${o.input.kind === 'project' || o.input.kind === 'task' ? 'text-work-4' : 'text-fg-muted'}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.detail && <span className="shrink-0 text-xs text-fg-muted">{o.detail}</span>}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-line pt-2">
        <label htmlFor={ids.intent} className="sr-only">
          Intent (optional)
        </label>
        <input
          id={ids.intent}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void start(options[current]);
            }
          }}
          placeholder="Intent, if you like (optional)"
          className="h-8 w-full rounded-md bg-transparent px-2 text-sm placeholder:text-fg-subtle focus:bg-canvas"
        />
      </div>
      {error && <ErrorNotice>Couldn’t start work. Nothing changed.</ErrorNotice>}
      <p className="mt-1 px-1 text-[11px] text-fg-muted">
        ↑↓ to choose · Enter to start · Esc to close
      </p>
    </div>
  );
}
