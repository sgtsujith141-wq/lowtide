import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/*
 * Guarded access to an exported LOWTIDE workspace (ADR-054, ADR-055).
 * Everything stays inside the workspace root: paths are resolved and
 * realpath-checked, so `..` or a symlink can't reach the rest of the disk.
 * The scope decides which projects are visible at all.
 */

export type Scope = { kind: 'project'; slug: string } | { kind: 'workspace' };

export interface ManifestProject {
  slug: string;
  id: string;
  name: string;
  archived: boolean;
}

export const MAX_READ_BYTES = 256 * 1024;
export const MAX_NOTE_BYTES = 64 * 1024;

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

export class Workspace {
  readonly root: string;
  readonly scope: Scope;
  private readonly now: () => Date;

  constructor(root: string, scope: Scope, now: () => Date = () => new Date()) {
    if (!existsSync(join(root, '.lowtide', 'manifest.json'))) {
      throw new AccessError(
        `${root} is not an exported LOWTIDE workspace (no .lowtide/manifest.json)`,
      );
    }
    this.root = realpathSync(root);
    this.scope = scope;
    this.now = now;
    if (scope.kind === 'project' && !this.projects().some((p) => p.slug === scope.slug)) {
      throw new AccessError(`No project "${scope.slug}" in this workspace`);
    }
  }

  projects(): ManifestProject[] {
    const manifest = JSON.parse(
      readFileSync(join(this.root, '.lowtide', 'manifest.json'), 'utf8'),
    ) as {
      projects: ManifestProject[];
    };
    return manifest.projects;
  }

  /** The folder of a project visible in this scope. */
  projectDir(slug: string | undefined): { slug: string; dir: string } {
    const wanted = slug ?? (this.scope.kind === 'project' ? this.scope.slug : undefined);
    if (!wanted) throw new AccessError('Say which project (workspace scope)');
    if (this.scope.kind === 'project' && wanted !== this.scope.slug) {
      throw new AccessError(`This connection is scoped to "${this.scope.slug}" only`);
    }
    const project = this.projects().find((p) => p.slug === wanted);
    if (!project) throw new AccessError(`No project "${wanted}"`);
    const dir = project.archived ? `archive/projects/${wanted}` : `projects/${wanted}`;
    return { slug: wanted, dir };
  }

  /** Workspace-relative prefixes this scope may read. */
  private readable(): string[] {
    if (this.scope.kind === 'workspace') return [''];
    const { dir } = this.projectDir(this.scope.slug);
    return [`${dir}/`];
  }

  /** Resolves a workspace-relative path, refusing anything outside the root or scope. */
  resolve(path: string, forWrite = false): string {
    if (path.includes('\0')) throw new AccessError('Invalid path');
    const absolute = resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(this.root, rel) !== absolute) {
      throw new AccessError('Path is outside the workspace');
    }
    const normal = rel.split(sep).join('/');
    if (
      !this.readable().some(
        (prefix) => normal === prefix.replace(/\/$/, '') || normal.startsWith(prefix),
      )
    ) {
      throw new AccessError('Path is outside this connection’s scope');
    }
    // Follow symlinks for existing paths (and the nearest existing parent for new files).
    let probe = absolute;
    while (!existsSync(probe)) probe = dirname(probe);
    const real = realpathSync(probe);
    if (real !== this.root && !real.startsWith(this.root + sep)) {
      throw new AccessError('Path leaves the workspace through a link');
    }
    if (forWrite && existsSync(absolute))
      throw new AccessError('Refusing to overwrite an existing file');
    return absolute;
  }

  read(path: string): string {
    const file = this.resolve(path);
    if (!existsSync(file) || !statSync(file).isFile()) throw new AccessError(`No file ${path}`);
    if (statSync(file).size > MAX_READ_BYTES)
      throw new AccessError(`${path} is too large to return`);
    return readFileSync(file, 'utf8');
  }

  /** Text files in scope, workspace-relative, sorted. */
  list(): string[] {
    const out: string[] = [];
    const walk = (rel: string) => {
      const abs = join(this.root, rel);
      for (const name of readdirSync(abs)) {
        if (name === 'audit.log') continue;
        const child = rel ? `${rel}/${name}` : name;
        const stat = statSync(join(abs, name));
        if (stat.isDirectory()) walk(child);
        else if (/\.(md|json|txt)$/.test(name) && stat.size <= MAX_READ_BYTES) out.push(child);
      }
    };
    for (const prefix of this.readable()) {
      const start = prefix.replace(/\/$/, '');
      if (!start || existsSync(join(this.root, start))) walk(start);
    }
    return out.sort();
  }

  /** Creates a new file (never overwrites) and records it in the audit log. */
  create(path: string, text: string, audit: Record<string, unknown>): string {
    if (Buffer.byteLength(text) > MAX_NOTE_BYTES) throw new AccessError('Too large to write');
    const file = this.resolve(path, true);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { flag: 'wx' });
    this.audit({ ...audit, wrote: path });
    return path;
  }

  audit(entry: Record<string, unknown>) {
    const log = join(this.root, '.lowtide', 'audit.log');
    appendFileSync(log, `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`);
  }

  today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}
