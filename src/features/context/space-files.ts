import type { BackupData } from '../../db/repositories';
import type { EntityLink, Project, SpaceCellValue, SpaceNode } from '../../types/domain';
import { slugOf } from './slug';

/*
 * A project's SPACE knowledge in the technical workspace (ADR-062): every
 * live page and table under the project's SPACE node, as generated Markdown
 * in projects/<slug>/space/, following SPACE's hierarchy. Only a project's
 * own subtree is ever written: Personal, Ideas, College and the rest of
 * SPACE stay in LOWTIDE. Archived nodes are left out.
 */

export interface SpaceFile {
  path: string;
  node: SpaceNode;
}

/** Workspace paths for the project's SPACE nodes, parents before children. */
export function projectSpaceLayout(data: BackupData, project: Project, root: string): SpaceFile[] {
  const top = data.spaceNodes.find((n) => n.key === `project:${project.id}`);
  if (!top) return [];
  const children = new Map<string, SpaceNode[]>();
  for (const node of data.spaceNodes) {
    if (node.parentId === undefined || node.archived) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const out: SpaceFile[] = [];
  const walk = (parent: SpaceNode, dir: string) => {
    const used = new Set<string>();
    const kids = (children.get(parent.id) ?? []).sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
    for (const node of kids) {
      let name = slugOf(node.title) || 'untitled';
      while (used.has(name)) name = `${name}-${node.id.slice(0, 4)}`;
      used.add(name);
      const hasChildren = (children.get(node.id)?.length ?? 0) > 0;
      if (node.kind !== 'section') out.push({ path: `${dir}/${name}.md`, node });
      if (hasChildren) walk(node, `${dir}/${name}`);
    }
  };
  walk(top, `${root}/space`);
  return out;
}

const escapeCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function cellText(value: SpaceCellValue | undefined, titles: Map<string, string>): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return (value as (string | EntityLink)[])
    .map((v) => (typeof v === 'string' ? v : (v.label ?? titles.get(v.id) ?? v.type)))
    .join(', ');
}

function relative(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** The generated files, keyed by workspace path. */
export function projectSpaceFiles(
  data: BackupData,
  project: Project,
  root: string,
  header: string,
): Map<string, string> {
  const layout = projectSpaceLayout(data, project, root);
  const pathOf = new Map(layout.map((f) => [f.node.id, f.path]));
  const titles = new Map(data.spaceNodes.map((n) => [n.id, n.title]));
  const files = new Map<string, string>();
  for (const { path, node } of layout) {
    const lines = [header, `# ${node.title}`, ''];
    if (node.source) {
      lines.push(
        `- Imported from ${node.source.system === 'notion' ? 'Notion' : node.source.system}: ${node.source.originalTitle}${node.source.url ? ` (${node.source.url})` : ''}`,
        '',
      );
    }
    if (node.body) {
      // SPACE links point at files here when they can, otherwise at their title.
      lines.push(
        node.body.replace(
          /\[([^\]]*)\]\(space:([0-9a-f-]{36})\)/g,
          (_all, label: string, id: string) => {
            const target = pathOf.get(id);
            return target ? `[${label}](${relative(path, target)})` : label;
          },
        ),
        '',
      );
    }
    if (node.table) {
      const { columns, rows } = node.table;
      if (columns.length) {
        lines.push(
          `| ${columns.map((c) => escapeCell(c.name)).join(' | ')} |`,
          `| ${columns.map(() => '---').join(' | ')} |`,
          ...rows.map(
            (r) =>
              `| ${columns.map((c) => escapeCell(cellText(r.cells[c.id], titles))).join(' | ')} |`,
          ),
          '',
        );
      }
    }
    if (node.attachments.length) {
      lines.push(
        '## Files',
        '',
        ...node.attachments.map(
          (a) => `- ${a.name} (${a.status === 'external' ? 'kept at its source' : 'stored'})`,
        ),
        '',
      );
    }
    files.set(path, lines.join('\n'));
  }
  return files;
}
