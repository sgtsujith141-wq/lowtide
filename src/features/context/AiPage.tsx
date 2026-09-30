import { FolderDown, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useCompanion } from '../../hooks/useCompanion';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { zipFiles } from '../../lib/zip';
import { downloadBytes } from '../backup/download';
import { AiAccess } from './AiAccess';
import { ContextPreview } from './ContextPreview';
import { useSnapshot } from './useSnapshot';
import type { ContextScope, GlobalGrants } from './pack';
import { buildWorkspace } from './workspace';

const GRANTS: { key: keyof GlobalGrants; label: string }[] = [
  { key: 'routines', label: 'Routines (this week’s counts)' },
  { key: 'offTime', label: 'Off-time windows (marked lengths)' },
  { key: 'college', label: 'College schedule (next two weeks)' },
  { key: 'inbox', label: 'Inbox thoughts' },
];

/**
 * AI & workspace (ADR-041, ADR-054, ADR-059). LOWTIDE has no AI built in.
 * With the companion, AI clients the owner allows reach LOWTIDE over MCP,
 * each within its own scope, and everything they do is audited here.
 * Without it, this page prepares context to hand over and exports the
 * technical workspace as a ZIP.
 */
export function AiPage() {
  useDocumentTitle('AI & workspace');
  const { backup } = useRepositories();
  const { client } = useCompanion();
  const { data, error, refresh } = useSnapshot();
  const [scopeKind, setScopeKind] = useState<'project' | 'workspace' | 'global'>('project');
  const [projectId, setProjectId] = useState('');
  const [grants, setGrants] = useState<GlobalGrants>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const ids = { project: useId(), scope: useId() };

  const projects = data?.projects.filter((p) => p.state !== 'archived') ?? [];
  const chosen = projectId || projects[0]?.id || '';
  const scope: ContextScope | null =
    scopeKind === 'project'
      ? chosen
        ? { kind: 'project', projectId: chosen }
        : null
      : scopeKind === 'workspace'
        ? { kind: 'workspace' }
        : { kind: 'global', grants };

  async function exportWorkspace() {
    setExportError(null);
    try {
      const doc = await backup.exportBackup();
      const now = new Date();
      const files = buildWorkspace(doc.data, now);
      const name = `lowtide-workspace-${now.toISOString().slice(0, 10)}.zip`;
      downloadBytes(name, zipFiles(files, now), 'application/zip');
      setAnnouncement(`Downloaded ${name} with ${files.size} files.`);
    } catch {
      setExportError('Couldn’t build the workspace. Nothing was downloaded.');
    }
  }

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">AI &amp; workspace</h1>
      {client ? (
        <>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            LOWTIDE has no AI built in. Through the companion on this computer, the AI clients you
            allow can read and change LOWTIDE over MCP, each only within the scope you give it.
            Every change is attributed to the client that made it and recorded below.
          </p>
          <AiAccess client={client} projects={data?.projects ?? []} />
        </>
      ) : (
        <>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            LOWTIDE has no AI built in and makes no network requests. Here you prepare the context
            an AI may see, and export the technical workspace. To let AI clients like Claude Code
            work with LOWTIDE directly, move LOWTIDE into the companion in{' '}
            <Link to="/settings" className="text-accent-ink underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
          <section
            aria-labelledby="workspace-heading"
            className="mt-6 rounded-xl border border-line bg-paper-raised p-4"
          >
            <h2
              id="workspace-heading"
              className="flex items-center gap-2 font-serif text-lg font-semibold"
            >
              <FolderDown aria-hidden className="size-5 text-ink-muted" /> Technical workspace
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              A folder of Markdown for every project (PROJECT.md, CONTEXT.md, decisions, notes, AI
              sessions) and hackathons. Unzip it where your tools can read it. With the companion,
              it stays up to date by itself instead.
            </p>
            <p className="mt-2 flex items-start gap-2 text-sm">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
              Never included: protected time, sleep and off-time logs, routines and medication,
              health records, college records, raw inbox.
            </p>
            <Button variant="primary" className="mt-3" onClick={() => void exportWorkspace()}>
              Export workspace (.zip)
            </Button>
            {exportError && <ErrorNotice>{exportError}</ErrorNotice>}
          </section>
        </>
      )}

      <section
        aria-labelledby="context-heading"
        className="mt-6 rounded-xl border border-line bg-paper-raised p-4"
      >
        <h2 id="context-heading" className="font-serif text-lg font-semibold">
          Context packs
        </h2>
        <fieldset className="mt-2">
          <legend id={ids.scope} className={labelClass}>
            Scope
          </legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ['project', 'Project (default for coding agents)'],
                ['workspace', 'Workspace (all projects, technical)'],
                ['global', 'Global (broader, by explicit grant)'],
              ] as const
            ).map(([kind, label]) => (
              <label key={kind} className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="scope"
                  value={kind}
                  checked={scopeKind === kind}
                  onChange={() => setScopeKind(kind)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {scopeKind === 'project' && projects.length > 0 && (
          <div className="mt-3">
            <label htmlFor={ids.project} className={labelClass}>
              Project
            </label>
            <select
              id={ids.project}
              value={chosen}
              onChange={(e) => setProjectId(e.target.value)}
              className={`${fieldClass} w-auto`}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {scopeKind === 'global' && (
          <fieldset className="mt-3 rounded-md border border-line p-3">
            <legend className="px-1 text-xs font-medium text-ink-muted">
              Private areas this assistant may see (off unless you tick them)
            </legend>
            <div className="grid gap-1 text-sm sm:grid-cols-2">
              {GRANTS.map((g) => (
                <label key={g.key} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={grants[g.key] === true}
                    onChange={(e) => setGrants({ ...grants, [g.key]: e.target.checked })}
                  />
                  {g.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Protected time can’t be granted: it is never part of any context.
            </p>
          </fieldset>
        )}

        <div className="mt-4">
          {error && <ErrorNotice>Couldn’t read LOWTIDE’s data.</ErrorNotice>}
          {data && scope && (
            <ContextPreview
              data={data}
              scope={scope}
              fileName={scopeKind === 'project' ? 'CONTEXT.md' : `CONTEXT-${scopeKind}.md`}
              onRefresh={refresh}
            />
          )}
          {data && !scope && (
            <p className="text-sm text-ink-muted">
              No projects yet. Create one to get its context.
            </p>
          )}
        </div>
      </section>

      <Announcer message={announcement} />
    </>
  );
}
