import { Check, Copy, FolderGit2, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import type { CompanionClient } from '../../db/companion/client';
import {
  CAPABILITY_GROUPS,
  CAPABILITY_LABEL,
  CLIENT_KINDS,
  CLIENT_LABEL,
  GRANT_PRESETS,
  PRESET,
  SENSITIVE,
  SENSITIVE_LABEL,
  type AuditEntry,
  type Capability,
  type GrantPreset,
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
import { AiChanges } from './AiChanges';
import type { Project } from '../../types/domain';

/*
 * AI access through the companion (ADR-059): who is connected, what each
 * client may do, and everything they did. Connection status comes only from
 * real protocol traffic; nothing here claims a client is connected because
 * it has a grant.
 */

/** Heard from within this window counts as connected (the bridge pings every minute). */
const CONNECTED_MS = 2 * 60_000;
const box = 'mt-8 border-t border-line pt-6';

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
  const [granting, setGranting] = useState(false);
  const [editing, setEditing] = useState<Grant | null>(null);
  const [onlyGrant, setOnlyGrant] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');

  return (
    <>
      {admin.failed && <ErrorNotice>Couldn’t read AI access from the companion.</ErrorNotice>}
      <Clients clients={admin.clients} />
      {created && admin.status && (
        <TokenOnce created={created} status={admin.status} onDone={() => setCreated(null)} />
      )}
      <Grants
        granting={granting}
        onGrant={() => {
          setEditing(null);
          setGranting(true);
        }}
        grants={admin.grants}
        clients={admin.clients}
        projects={projects}
        onEdit={(grant) => {
          setGranting(false);
          setEditing(grant);
        }}
        onActivity={(grant) => {
          setOnlyGrant(grant.id);
          requestAnimationFrame(() =>
            document.getElementById('changes-heading')?.scrollIntoView({ block: 'start' }),
          );
        }}
        onRevoke={async (grant) => {
          await client.revokeGrant(grant.id);
          setAnnouncement(`${grant.label} can no longer use LOWTIDE.`);
          void admin.reload();
        }}
      />
      {(granting || editing) && (
        <GrantForm
          key={editing?.id ?? 'new'}
          client={client}
          projects={projects}
          grant={editing ?? undefined}
          onCancel={() => {
            setGranting(false);
            setEditing(null);
          }}
          onDone={(result) => {
            if (result.token) {
              setCreated({ grant: result.grant, token: result.token });
              setAnnouncement(`Access created for ${result.grant.label}. Copy its token now.`);
            } else {
              setAnnouncement(`Access changed for ${result.grant.label}.`);
            }
            setGranting(false);
            setEditing(null);
            void admin.reload();
          }}
        />
      )}
      <AiChanges
        client={client}
        grants={admin.grants}
        onlyGrant={onlyGrant}
        onShowAll={() => setOnlyGrant(undefined)}
      />
      <details className={box}>
        <summary className="cursor-pointer text-section font-semibold select-none">
          Technical log
        </summary>
        <AuditLog entries={admin.audit} projects={projects} />
      </details>
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
      <h2 id="clients-heading" className="text-section font-semibold">
        AI clients
      </h2>
      <p className="mt-1 text-xs text-fg-muted">
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
                  className={`rounded-full px-2 py-0.5 text-xs ${connected ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-fg-muted'}`}
                >
                  {connected ? 'Connected' : seen ? 'Not connected' : 'Never connected'}
                </span>
              </p>
              <p className="mt-1 text-xs text-fg-muted">
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

const PRESET_ORDER = [...GRANT_PRESETS, 'custom'] as const;

const PRESET_TEXT: Record<GrantPreset, { label: string; description: string }> = {
  read: PRESET.read,
  project: PRESET.project,
  workspace: PRESET.workspace,
  full: PRESET.full,
  custom: { label: 'Custom', description: 'Choose exactly what it can see and do.' },
};

/** What a preset (or custom choice) adds up to, before it's saved. */
function accessFor(
  preset: GrantPreset,
  custom: { scope: GrantScope; capabilities: Capability[]; sensitive: SensitiveCategory[] },
) {
  if (preset === 'custom') return custom;
  const p = PRESET[preset];
  return { scope: p.scope, capabilities: p.capabilities, sensitive: p.sensitive };
}

function AccessSummary({
  capabilities,
  sensitive,
}: {
  capabilities: Capability[];
  sensitive: SensitiveCategory[];
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-3 text-xs">
      <p className="font-medium text-fg">It can</p>
      {capabilities.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg-muted">
          {capabilities.map((c) => (
            <li key={c}>{CAPABILITY_LABEL[c]}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-fg-muted">Nothing yet: choose at least one permission.</p>
      )}
      {sensitive.length > 0 && (
        <>
          <p className="mt-2 font-medium text-fg">Private areas included</p>
          <p className="mt-0.5 text-fg-muted">
            {sensitive.map((s) => SENSITIVE_LABEL[s].split(' (')[0]).join(', ')}
          </p>
        </>
      )}
      <p className="mt-2 font-medium text-fg">Never</p>
      <p className="mt-0.5 text-fg-muted">
        Protected Time, tokens and access settings, or deleting anything for good.
      </p>
    </div>
  );
}

/** Give access (or, with `grant`, change what an existing grant may do). */
function GrantForm({
  client,
  projects,
  grant,
  onDone,
  onCancel,
}: {
  client: CompanionClient;
  projects: Project[];
  grant?: Grant | undefined;
  onDone: (result: { grant: Grant; token?: string }) => void;
  onCancel: () => void;
}) {
  const ids = { kind: useId(), label: useId(), project: useId() };
  const editing = grant !== undefined;
  const [kind, setKind] = useState<ClientKind>(grant?.clientKind ?? 'claude-code');
  const [label, setLabel] = useState(grant?.label ?? '');
  const [preset, setPreset] = useState<GrantPreset>(grant?.preset ?? 'project');
  const [scope, setScope] = useState<GrantScope>(grant?.scope ?? 'workspace');
  const [projectId, setProjectId] = useState(grant?.projectId ?? '');
  const [capabilities, setCapabilities] = useState<Capability[]>(
    grant?.capabilities ?? PRESET.read.capabilities,
  );
  const [sensitive, setSensitive] = useState<SensitiveCategory[]>(grant?.sensitive ?? []);
  const [error, setError] = useState<string | null>(null);
  const live = projects.filter((p) => p.state !== 'archived');
  const chosen = projectId || live[0]?.id || '';
  const access = accessFor(preset, { scope, capabilities, sensitive });
  const needsProject = access.scope === 'project';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (needsProject && !chosen) {
      setError('Create a project first, or choose another kind of access.');
      return;
    }
    if (access.capabilities.length === 0) {
      setError('Choose at least one permission.');
      return;
    }
    const body = {
      label: label.trim() || CLIENT_LABEL[kind],
      scope: access.scope,
      ...(needsProject ? { projectId: chosen } : {}),
      capabilities: access.capabilities,
      preset,
      sensitive: access.scope === 'global' ? access.sensitive : [],
    };
    try {
      if (grant) {
        onDone({ grant: await client.updateGrant(grant.id, body) });
      } else {
        onDone(await client.createGrant({ ...body, clientKind: kind }));
      }
    } catch {
      setError(
        editing
          ? 'Couldn’t change that access. Nothing changed.'
          : 'Couldn’t create that access. Nothing changed.',
      );
    }
  }

  const radio = 'inline-flex items-center gap-1.5';
  const formName = editing ? `Change access for ${grant.label}` : 'Give an AI client access';
  return (
    <section aria-label={formName} className={box}>
      <h2 className="flex items-center gap-2 text-section font-semibold">
        <KeyRound aria-hidden className="size-5 text-fg-muted" /> {formName}
      </h2>
      <form
        aria-label={formName}
        onSubmit={(e) => void submit(e)}
        className="mt-2 space-y-3 text-sm"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && (
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
          )}
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
          <legend className={labelClass}>Access</legend>
          <div className="grid gap-2">
            {PRESET_ORDER.map((value) => (
              <label key={value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`${ids.kind}-preset`}
                  className="mt-1"
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                />
                <span>
                  {PRESET_TEXT[value].label}
                  <span className="block text-xs text-fg-muted">
                    {PRESET_TEXT[value].description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {preset === 'custom' && (
          <>
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
                      name={`${ids.kind}-scope`}
                      checked={scope === value}
                      onChange={() => setScope(value)}
                    />
                    {text}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="rounded-md border border-line p-3">
              <legend className="px-1 text-xs font-medium text-fg-muted">What it can do</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {CAPABILITY_GROUPS.map((g) => (
                  <fieldset key={g.title}>
                    <legend className="text-xs font-medium">{g.title}</legend>
                    {g.capabilities.map((c) => (
                      <label key={c} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={capabilities.includes(c)}
                          onChange={(e) =>
                            setCapabilities(
                              e.target.checked
                                ? [...capabilities, c]
                                : capabilities.filter((x) => x !== c),
                            )
                          }
                        />
                        {CAPABILITY_LABEL[c]}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            </fieldset>
            {scope === 'global' && (
              <fieldset className="rounded-md border border-line p-3">
                <legend className="px-1 text-xs font-medium text-fg-muted">
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
                <p className="mt-2 text-xs text-fg-muted">
                  Protected time can’t be shared with any AI client.
                </p>
              </fieldset>
            )}
          </>
        )}
        {needsProject && live.length > 0 && (
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
        <AccessSummary
          capabilities={access.capabilities}
          sensitive={access.scope === 'global' ? access.sensitive : []}
        />
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            {editing ? 'Save access' : 'Create access'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
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
      <h2 id={id} className="text-section font-semibold">
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
          <p className="text-fg-muted">{c.title}</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-surface p-2 text-xs whitespace-pre-wrap break-all">
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

function permissionsText(g: Grant) {
  if (g.preset !== 'custom') return PRESET[g.preset].label;
  const writes = g.capabilities.filter((c) => !c.endsWith('.read')).length;
  return writes ? `Custom: ${writes} kinds of change` : 'Custom: read only';
}

function Grants({
  grants,
  clients,
  projects,
  onRevoke,
  granting,
  onGrant,
  onEdit,
  onActivity,
}: {
  granting: boolean;
  onGrant: () => void;
  grants: Grant[];
  clients: ClientStatus[];
  projects: Project[];
  onRevoke: (grant: Grant) => Promise<void>;
  onEdit: (grant: Grant) => void;
  onActivity: (grant: Grant) => void;
}) {
  const now = useNow(true, 30_000);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const active = grants.filter((g) => !g.revokedAt);
  const revoked = grants.filter((g) => g.revokedAt);
  return (
    <section aria-labelledby="grants-heading" className={box}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="grants-heading" className="text-section font-semibold">
          Access you’ve given
        </h2>
        {!granting && (
          <Button size="sm" onClick={onGrant}>
            <KeyRound aria-hidden className="size-3.5" /> Give access
          </Button>
        )}
      </div>
      {active.length === 0 ? (
        <p className="mt-1 text-sm text-fg-muted">No AI client can use LOWTIDE right now.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm" aria-label="Access you’ve given">
          {active.map((g) => {
            const status = clients.find((c) => c.kind === g.clientKind);
            const seen = status?.lastSeenAt;
            const connected =
              seen !== undefined &&
              status?.grants.some((x) => x.id === g.id) === true &&
              now.getTime() - Date.parse(seen) <= CONNECTED_MS;
            return (
              <li key={g.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0">
                    <span className="font-medium">{g.label}</span>{' '}
                    <span className="text-fg-muted">({CLIENT_LABEL[g.clientKind]})</span>{' '}
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-xs ${connected ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-fg-muted'}`}
                    >
                      {connected ? 'Connected' : 'Not connected'}
                    </span>
                  </p>
                  <span className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit access for ${g.label}`}
                      onClick={() => onEdit(g)}
                    >
                      Edit access
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`View activity of ${g.label}`}
                      onClick={() => onActivity(g)}
                    >
                      View activity
                    </Button>
                    {confirming === g.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setError(null);
                            setConfirming(null);
                            onRevoke(g).catch(() => setError('Couldn’t revoke that access.'));
                          }}
                        >
                          Yes, revoke {g.label}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Keep it
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(g.id)}>
                        <Trash2 aria-hidden className="size-3.5" /> Revoke {g.label}
                      </Button>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {scopeText(g, projects)} · {permissionsText(g)}
                  {g.sensitive.length
                    ? ` · also ${g.sensitive.map((s) => SENSITIVE_LABEL[s].split(' (')[0]!.toLowerCase()).join(', ')}`
                    : ''}
                  {seen && (
                    <>
                      {' · last activity '}
                      <time dateTime={seen} title={formatFull(seen)}>
                        {formatWhen(seen, now)}
                      </time>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {revoked.length > 0 && (
        <details className="mt-2 text-xs text-fg-muted">
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
  get_space_tree: 'read the SPACE tree',
  get_space_page: 'read a SPACE page',
  search_space: 'searched SPACE',
  create_space_page: 'saved a SPACE page',
  create_space_subpage: 'added a SPACE subpage',
  append_space_blocks: 'added to a SPACE page',
  update_space_block: 'changed a SPACE page',
  add_space_table_row: 'added a table row',
  link_space_entity: 'linked a SPACE page',
  archive_space_page: 'archived a SPACE page',
};

function AuditLog({ entries, projects }: { entries: AuditEntry[]; projects: Project[] }) {
  const [changesOnly, setChangesOnly] = useState(true);
  const now = new Date();
  const shown = changesOnly
    ? entries.filter(
        (e) =>
          !e.operation.startsWith('get_') &&
          e.operation !== 'search_workspace' &&
          e.operation !== 'search_space',
      )
    : entries;
  const projectName = (scope: string) =>
    scope.startsWith('project ')
      ? (projects.find((p) => p.id === scope.slice(8))?.name ?? 'a project')
      : scope;
  return (
    <section aria-labelledby="audit-heading" className="mt-2">
      <h3 id="audit-heading" className="sr-only">
        Every call AI clients made
      </h3>
      <label className="mt-1 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={changesOnly}
          onChange={(e) => setChangesOnly(e.target.checked)}
        />
        Changes and refusals only
      </label>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">Nothing yet.</p>
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
                  {e.before && <span className="text-fg-muted">{e.before} → </span>}
                  {e.after}
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-fg-muted">
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
    <details className={box}>
      <summary className="cursor-pointer text-section font-semibold select-none">
        <span id="live-workspace-heading" className="inline-flex items-center gap-2">
          <FolderGit2 aria-hidden className="size-5 text-fg-muted" /> Technical workspace
        </span>
      </summary>
      <p className="mt-1 text-sm">
        <code className="break-all">{info.dir}</code>
      </p>
      <p className="mt-1 text-sm text-fg-muted">
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
            <p className="text-fg-muted">
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
    </details>
  );
}
