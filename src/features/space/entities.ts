import { useMemo } from 'react';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch, type Live } from '../../hooks/useWatch';
import type { EntityLink, Id, LinkableType, SpaceNode } from '../../types/domain';

/*
 * LOWTIDE records as SPACE sees them (v2 PHASE 014): a name, a word for the
 * kind, and where each opens, for link blocks, link cells, the inspector and
 * the entity picker. Live: a renamed task reads renamed everywhere.
 */

export const LINK_WORD: Record<LinkableType, string> = {
  project: 'Project',
  task: 'Task',
  milestone: 'Milestone',
  projectItem: 'Item',
  decision: 'Decision',
  hackathon: 'Hackathon',
  aiSession: 'AI session',
  spaceNode: 'Page',
};

export interface EntityOption {
  type: LinkableType;
  id: Id;
  label: string;
  /** Where it belongs (its project, its location). */
  detail?: string;
}

export interface EntityLookup {
  label(link: EntityLink): string;
  href(link: EntityLink): string | undefined;
  /** False when the record no longer exists. */
  exists(link: EntityLink): boolean;
  options(type: LinkableType): EntityOption[];
  projectName(id: Id): string | undefined;
}

const list = <T>(live: Live<T[]>): T[] => (live.status === 'ready' ? live.data : []);

export function useEntityLookup(nodes: readonly SpaceNode[]): EntityLookup {
  const { projects, tasks, hackathons } = useRepositories();
  const all = useWatch(projects.watchAll);
  const milestones = useWatch(projects.watchAllMilestones);
  const items = useWatch(projects.watchAllItems);
  const decisions = useWatch(projects.watchAllDecisions);
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const hacks = useWatch(hackathons.watchAll);

  return useMemo(() => {
    const projectList = list(all);
    const project = new Map(projectList.map((p) => [p.id, p]));
    const slug = (projectId: Id | undefined) =>
      projectId ? project.get(projectId)?.slug : undefined;
    const records = new Map<string, { label: string; href?: string; detail?: string }>();
    const put = (type: LinkableType, id: Id, label: string, href?: string, detail?: string) =>
      records.set(`${type}:${id}`, {
        label,
        ...(href ? { href } : {}),
        ...(detail ? { detail } : {}),
      });
    const inProject = (projectId: Id) =>
      [`/projects/${slug(projectId)}`, project.get(projectId)?.name] as const;
    for (const p of projectList) put('project', p.id, p.name, `/projects/${p.slug}`);
    for (const m of list(milestones)) put('milestone', m.id, m.title, ...inProject(m.projectId));
    for (const i of list(items)) put('projectItem', i.id, i.title, ...inProject(i.projectId));
    for (const d of list(decisions)) put('decision', d.id, d.title, ...inProject(d.projectId));
    for (const t of [...list(open), ...list(closed)]) {
      if (t.projectId) put('task', t.id, t.title, ...inProject(t.projectId));
      else put('task', t.id, t.title, '/tasks');
    }
    for (const h of list(hacks)) put('hackathon', h.id, h.name, '/hackathons');
    for (const n of nodes) put('spaceNode', n.id, n.title, `/space/${n.id}`);
    return {
      label: (link) =>
        records.get(`${link.type}:${link.id}`)?.label ?? link.label ?? LINK_WORD[link.type],
      href: (link) => records.get(`${link.type}:${link.id}`)?.href,
      exists: (link) => records.has(`${link.type}:${link.id}`),
      options: (type) =>
        [...records.entries()]
          .filter(([key]) => key.startsWith(`${type}:`))
          .map(([key, r]) => ({
            type,
            id: key.slice(type.length + 1),
            label: r.label,
            ...(r.detail ? { detail: r.detail } : {}),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      projectName: (id) => project.get(id)?.name,
    };
  }, [all, milestones, items, decisions, open, closed, hacks, nodes]);
}
