import { Check, Copy, FolderGit2, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import type { CompanionClient } from '../../db/companion/client';
import {
  CLIENT_KINDS,
  CLIENT_LABEL,
  SENSITIVE,
  SENSITIVE_LABEL,
  type AuditEntry,
  type ClientKind,
  type ClientStatus,
  type CompanionStatus,
  type Grant,
  type GrantScope,
  type SensitiveCategory,
  type WorkspaceInfo,
} from '../../db/companion/wire';
import { useNow } from '../../hooks/useNow';
import { formatFull, formatWhen } from '../../lib/when';
import type { Project } from '../../types/domain';

/*
 * AI access through the companion (ADR-059): who is connected, what each
 * client may do, and everything they did. Connection status comes only from
 * real protocol traffic; nothing here claims a client is connected because
 * it has a grant.
 */

/** Heard from within this window counts as connected (the bridge pings every minute). */
const CONNECTED_MS = 2 * 60_000;
const box = 'mt-6 rounded-xl border border-line bg-paper-raised p-4';

interface Loaded {
  status: CompanionStatus | null;
  clients: ClientStatus[];
  grants: Grant[];
  audit: AuditEntry[];
  workspace: WorkspaceInfo | null;
}

function useCompanionAdmin(client: CompanionClient) {
  const [data, setData] = useState<Loaded>({
    status: null,
    clients: [],
    grants: [],
    audit: [],
    workspace: null,
  });
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const [status, clients, grants, audit, workspace] = await Promise.all([
        client.status(),
        client.clients(),
        client.grants(),
        client.audit(200),
        client.workspace(),
      ]);
      setData({ status, clients, grants, audit, workspace });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Initial load, then again whenever the companion reports AI or workspace activity.
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 50);
    };
    later();
    const off = client.onEvent((event) => {
      if (event.type === 'ai' || event.type === 'workspace') later();
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [client, load]);
  return { ...data, failed, reload: load };
}

export function AiAccess({ client, projects }: { client: CompanionClient; projects: Project[] }) {
  const admin = useCompanionAdmin(client);
  const [created, setCreated] = useState<{ grant: Grant; token: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  return (
    <>
      {admin.failed && <ErrorNotice>Couldn’t read AI access from the companion.</ErrorNotice>}
      <Clients clients={admin.clients} />
      <NewGrant
        client={client}
        projects={projects}
        onCreated={(result) => {
          setCreated(result);
          setAnnouncement(`Access created for ${result.grant.label}. Copy its token now.`);
          void admin.reload();
        }}
      />
      {created && admin.status && (
        <TokenOnce created={created} status={admin.status} onDone={() => setCreated(null)} />
      )}
      <Grants
        grants={admin.grants}
        projects={projects}
        onRevoke={async (grant) => {
          await client.revokeGrant(grant.id);
          setAnnouncement(`${grant.label} can no longer use LOWTIDE.`);
          void admin.reload();
        }}
      />
      <AuditLog entries={admin.audit} projects={projects} />
      <Workspace
        info={admin.workspace}
        onInit={async () => {
          await client.gitInit();
          setAnnouncement('The workspace is now a private Git repository.');
          void admin.reload();
        }}
      />
      <Announcer message={announcement} />
    </>
  );
}

/* --------------------------------- clients --------------------------------- */

function Clients({ clients }: { clients: ClientStatus[] }) {
  const now = useNow(true, 30_000);
  return (
    <section aria-labelledby="clients-heading" className={box}>
      <h2 id="clients-heading" className="font-serif text-lg font-semibold">
        AI clients
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Connected means LOWTIDE heard from it in the last two minutes over MCP. Having access isn’t
        the same as being connected.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {CLIENT_KINDS.map((kind) => {
          const status = clients.find((c) => c.kind === kind);
          const seen = status?.lastSeenAt;
          const connected = seen !== undefined && now.getTime() - Date.parse(seen) <= CONNECTED_MS;
          return (
            <li key={kind} className="rounded-lg border border-line p-3 text-sm">
              <p className="flex items-center justify-between gap-2">
                <span className="font-medium">{CLIENT_LABEL[kind]}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${connected ? 'bg-accent-soft text-accent-ink' : 'bg-paper-sunken text-ink-muted'}`}
                >
                  {connected ? 'Connected' : seen ? 'Not connected' : 'Never connected'}
                </span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {status?.grants.length
                  ? `${status.grants.length} active access ${status.grants.length === 1 ? 'grant' : 'grants'}`
                  : 'No access given'}
                {seen && (
                  <>
                    {' · last heard '}
                    <time dateTime={seen} title={formatFull(seen)}>
                      {formatWhen(seen, now)}
                    </time>
                    {status?.clientName ? ` (${status.clientName})` : ''}
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------- grants ---------------------------------- */

function NewGrant({
  client,
  projects,
  onCreated,
}: {
  client: CompanionClient;
  projects: Project[];
  onCreated: (result: { grant: Grant; token: string }) => void;
}) {
  const ids = { kind: useId(), label: useId(), project: useId() };
  const [kind, setKind] = useState<ClientKind>('claude-code');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<GrantScope>('project');
  const [projectId, setProjectId] = useState('');
  const [access, setAccess] = useState<'read' | 'write'>('read');
  const [resolve, setResolve] = useState(false);
  const [sensitive, setSensitive] = useState<SensitiveCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const live = projects.filter((p) => p.state !== 'archived');
  const chosen = projectId || live[0]?.id || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (scope === 'project' && !chosen) {
      setError('Create a project first, or choose the workspace scope.');
      return;
    }
    try {
      const result = await client.createGrant({
        label: label.trim() || CLIENT_LABEL[kind],
        clientKind: kind,
        scope,
        ...(scope === 'project' ? { projectId: chosen } : {}),
        access,
        allowResolveApprovals: access === 'write' && resolve,
        sensitive: scope === 'global' ? sensitive : [],
      });
      onCreated(result);
      setLabel('');
      setResolve(false);
      setSensitive([]);
    } catch {
      setError('Couldn’t create that access. Nothing changed.');
    }
  }

  const radio = 'inline-flex items-center gap-1.5';
  return (
    <section aria-labelledby="grant-heading" className={box}>
      <h2 id="grant-heading" className="flex items-center gap-2 font-serif text-lg font-semibold">
        <KeyRound aria-hidden className="size-5 text-ink-muted" /> Give an AI client access
      </h2>
      <form
        aria-label="Give an AI client access"
        onSubmit={(e) => void submit(e)}
        className="mt-2 space-y-3 text-sm"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.kind} className={labelClass}>
              Client
            </label>
            <select
              id={ids.kind}
              value={kind}
              onChange={(e) => setKind(e.target.value as ClientKind)}
              className={fieldClass}
            >
              {CLIENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CLIENT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.label} className={labelClass}>
              Name (shown on everything it does)
            </label>
            <input
              id={ids.label}
              value={label}
              placeholder={CLIENT_LABEL[kind]}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              className={fieldClass}
            />
          </div>
        </div>
        <fieldset>
          <legend className={labelClass}>What it can see</legend>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ['project', 'One project'],
                ['workspace', 'Every project (technical)'],
                ['global', 'Global (broader)'],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className={radio}>
                <input
                  type="radio"
                  name="grant-scope"
                  checked={scope === value}
                  onChange={() => setScope(value)}
                />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        {scope === 'project' && live.length > 0 && (
          <div>
            <label htmlFor={ids.project} className={labelClass}>
              Project
            </label>
            <select
              id={ids.project}
              value={chosen}
              onChange={(e) => setProjectId(e.target.value)}
              className={`${fieldClass} w-auto`}
            >
              {live.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {scope === 'global' && (
          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-xs font-medium text-ink-muted">
              Private areas it may also see (off unless you tick them)
            </legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {SENSITIVE.map((s) => (
                <label key={s} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sensitive.includes(s)}
                    onChange={(e) =>
                      setSensitive(
                        e.target.checked ? [...sensitive, s] : sensitive.filter((x) => x !== s),
                      )
                    }
                  />
                  {SENSITIVE_LABEL[s]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Protected time can’t be shared with any AI client.
            </p>
          </fieldset>
        )}
        <fieldset>
          <legend className={labelClass}>What it can do</legend>
          <div className="flex flex-wrap gap-3">
            <label className={radio}>
              <input
                type="radio"
                name="grant-access"
                checked={access === 'read'}
                onChange={() => setAccess('read')}
              />
              Read only
            </label>
            <label className={radio}>
              <input
                type="radio"
                name="grant-access"
                checked={access === 'write'}
                onChange={() => setAccess('write')}
              />
              Read and make changes
            </label>
          </div>
        </fieldset>
        {access === 'write' && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={resolve}
              onChange={(e) => setResolve(e.target.checked)}
            />
            <span>
              May also resolve approval requests
              <span className="block text-xs text-ink-muted">
                Approvals are yours to give. Tick this only for a client you trust to act for you.
              </span>
            </span>
          </label>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Button type="submit" variant="primary">
          Create access
        </Button>
      </form>
    </section>
  );
}

function TokenOnce({
  created,
  status,
  onDone,
}: {
  created: { grant: Grant; token: string };
  status: CompanionStatus;
  onDone: () => void;
}) {
  const { grant, token } = created;
  const [copied, setCopied] = useState(false);
  const id = useId();
  const bridge = status.bridge;
  const commands: Record<ClientKind, { title: string; text: string }[]> = {
    'claude-code': [
      {
        title: 'In a terminal (Claude Code starts the bridge itself):',
        text: `claude mcp add lowtide --scope user -e LOWTIDE_TOKEN=${token} -- node ${bridge}`,
      },
    ],
    claude: [
      {
        title: 'In Claude Desktop’s claude_desktop_config.json, under "mcpServers":',
        text: JSON.stringify(
          { lowtide: { command: 'node', args: [bridge], env: { LOWTIDE_TOKEN: token } } },
          null,
          2,
        ),
      },
    ],
    chatgpt: [
      {
        title:
          'ChatGPT’s MCP connectors reach servers over the internet, and the companion deliberately listens only on this computer, so LOWTIDE has no tested ChatGPT connection. If your ChatGPT app can launch a local MCP command, it is:',
        text: `LOWTIDE_TOKEN=${token} node ${bridge}`,
      },
    ],
    other: [
      {
        title: 'A client that launches a local command (stdio):',
        text: `LOWTIDE_TOKEN=${token} node ${bridge}`,
      },
      {
        title: 'A client that speaks MCP over HTTP:',
        text: `${status.mcpUrl}\nAuthorization: Bearer ${token}`,
      },
    ],
  };
  return (
    <section aria-labelledby={id} className={`${box} border-accent`}>
      <h2 id={id} className="font-serif text-lg font-semibold">
        Token for {grant.label}
      </h2>
      <p className="mt-1 text-sm">
        Shown this once: LOWTIDE keeps only a fingerprint of it. Anyone with it can use this access,
        so put it only in the client’s own settings.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          aria-label="Token"
          value={token}
          className={`${fieldClass} font-mono text-xs`}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(token).then(() => setCopied(true));
          }}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {commands[grant.clientKind].map((c) => (
        <div key={c.title} className="mt-3 text-sm">
          <p className="text-ink-muted">{c.title}</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-paper-sunken p-2 text-xs whitespace-pre-wrap break-all">
            {c.text}
          </pre>
        </div>
      ))}
      <Button className="mt-3" onClick={onDone}>
        Done, I’ve saved it
      </Button>
    </section>
  );
}

function scopeText(grant: Pick<Grant, 'scope' | 'projectId'>, projects: Project[]) {
  if (grant.scope === 'project') {
    return `project ${projects.find((p) => p.id === grant.projectId)?.name ?? '(removed)'}`;
  }
  return grant.scope === 'workspace' ? 'every project' : 'global';
}

function Grants({
  grants,
  projects,
  onRevoke,
}: {
  grants: Grant[];
  projects: Project[];
  onRevoke: (grant: Grant) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const active = grants.filter((g) => !g.revokedAt);
  const revoked = grants.filter((g) => g.revokedAt);
  return (
    <section aria-labelledby="grants-heading" className={box}>
      <h2 id="grants-heading" className="font-serif text-lg font-semibold">
        Access you’ve given
      </h2>
      {active.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">No AI client can use LOWTIDE right now.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {active.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{g.label}</span>{' '}
                <span className="text-ink-muted">
                  ({CLIENT_LABEL[g.clientKind]}) · {scopeText(g, projects)} ·{' '}
                  {g.access === 'write' ? 'read and change' : 'read only'}
                  {g.allowResolveApprovals ? ' · may resolve approvals' : ''}
                  {g.sensitive.length
                    ? ` · also ${g.sensitive.map((s) => SENSITIVE_LABEL[s].split(' (')[0]!.toLowerCase()).join(', ')}`
                    : ''}
                </span>
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  setError(null);
                  onRevoke(g).catch(() => setError('Couldn’t revoke that access.'));
                }}
              >
                <Trash2 aria-hidden className="size-4" /> Revoke {g.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {revoked.length > 0 && (
        <details className="mt-2 text-xs text-ink-muted">
          <summary className="cursor-pointer">{revoked.length} revoked</summary>
          <ul className="mt-1 space-y-0.5">
            {revoked.map((g) => (
              <li key={g.id}>
                {g.label} ({scopeText(g, projects)}), revoked {formatFull(g.revokedAt!)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ----------------------------------- audit ----------------------------------- */

const OPERATION_LABEL: Record<string, string> = {
  get_context: 'read context',
  get_project: 'read project',
  get_project_summary: 'read summary',
  get_recent_activity: 'read activity',
  get_waiting: 'read waiting',
  get_approval_requests: 'read approvals',
  get_parked: 'read parked',
  get_decisions: 'read decisions',
  get_tasks: 'read tasks',
  get_milestones: 'read milestones',
  search_workspace: 'searched workspace',
  get_document: 'read document',
  create_note: 'added a note',
  record_decision: 'recorded a decision',
  update_project: 'updated the project',
  complete_task: 'completed a task',
  complete_milestone: 'completed a milestone',
  request_approval: 'asked for approval',
  resolve_approval: 'resolved an approval',
  park_item: 'parked an item',
  resume_item: 'resumed an item',
  log_ai_session: 'logged its session',
};

function AuditLog({ entries, projects }: { entries: AuditEntry[]; projects: Project[] }) {
  const [changesOnly, setChangesOnly] = useState(true);
  const now = new Date();
  const shown = changesOnly
    ? entries.filter((e) => !e.operation.startsWith('get_') && e.operation !== 'search_workspace')
    : entries;
  const projectName = (scope: string) =>
    scope.startsWith('project ')
      ? (projects.find((p) => p.id === scope.slice(8))?.name ?? 'a project')
      : scope;
  return (
    <section aria-labelledby="audit-heading" className={box}>
      <h2 id="audit-heading" className="font-serif text-lg font-semibold">
        What AI clients did
      </h2>
      <label className="mt-1 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={changesOnly}
          onChange={(e) => setChangesOnly(e.target.checked)}
        />
        Changes and refusals only
      </label>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing yet.</p>
      ) : (
        <ol className="mt-2 divide-y divide-line text-sm" aria-label="AI activity">
          {shown.map((e) => (
            <li key={e.id} className="py-2">
              <p>
                <span className="font-medium">{e.client}</span>{' '}
                {OPERATION_LABEL[e.operation] ?? e.operation}
                {e.result !== 'ok' && (
                  <span className="ml-1 text-danger">
                    ({e.result === 'refused' ? 'refused' : 'failed'}
                    {e.message ? `: ${e.message}` : ''})
                  </span>
                )}
              </p>
              {(e.before || e.after) && (
                <p className="mt-0.5 text-xs">
                  {e.before && <span className="text-ink-muted">{e.before} → </span>}
                  {e.after}
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-ink-muted">
                <time dateTime={e.at} title={formatFull(e.at)}>
                  {formatWhen(e.at, now)}
                </time>{' '}
                · {projectName(e.scope)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* --------------------------------- workspace --------------------------------- */

function Workspace({ info, onInit }: { info: WorkspaceInfo | null; onInit: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  if (!info) return null;
  return (
    <section aria-labelledby="live-workspace-heading" className={box}>
      <h2
        id="live-workspace-heading"
        className="flex items-center gap-2 font-serif text-lg font-semibold"
      >
        <FolderGit2 aria-hidden className="size-5 text-ink-muted" /> Technical workspace
      </h2>
      <p className="mt-1 text-sm">
        <code className="break-all">{info.dir}</code>
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Kept up to date by the companion after every change: PROJECT.md, CONTEXT.md, decisions,
        notes and AI sessions for each project. Your own files there are never changed.
        {info.lastSync && (
          <>
            {' '}
            Last updated{' '}
            <time dateTime={info.lastSync.at} title={formatFull(info.lastSync.at)}>
              {formatWhen(info.lastSync.at, new Date())}
            </time>
            .
          </>
        )}
      </p>
      {info.lastSync && info.lastSync.conflicts.length > 0 && (
        <p className="mt-1 text-sm text-danger">
          Not overwritten because a person edited them: {info.lastSync.conflicts.join(', ')}. Remove
          your edits (or move them to a note) to let LOWTIDE update them again.
        </p>
      )}
      <p className="mt-2 flex items-start gap-2 text-sm">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        Never written there: protected time, sleep and off-time logs, routines and medication,
        health records, college records, raw inbox.
      </p>
      <div className="mt-3 text-sm">
        {info.git.repository ? (
          <p>
            A private Git repository
            {info.git.remotes.length === 0
              ? ', with no remote'
              : ` (remotes: ${info.git.remotes.join(', ')})`}
            . {info.git.changes} uncommitted {info.git.changes === 1 ? 'change' : 'changes'}. You
            decide when to commit and whether to publish.
          </p>
        ) : (
          <>
            <p className="text-ink-muted">
              Make it a private Git repository to keep its history. LOWTIDE adds a .gitignore, never
              adds a remote and never commits for you.
            </p>
            <Button
              className="mt-2"
              onClick={() => {
                setError(null);
                onInit().catch(() => setError('Couldn’t set up Git there. Is Git installed?'));
              }}
            >
              Make it a Git repository
            </Button>
          </>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </div>
    </section>
  );
}
