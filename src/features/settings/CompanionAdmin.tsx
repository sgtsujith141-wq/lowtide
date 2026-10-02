import { CheckCircle2, CircleAlert, History, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import type { CompanionClient, CompanionHealth } from '../../db/companion/client';
import type { Checkpoint } from '../../db/companion/wire';
import { formatFull, formatWhen } from '../../lib/when';

/*
 * The companion as a service (v2.1): is everything healthy, does it start at
 * login, its log, a restart, and checkpoints (named copies of the whole
 * database to roll back to). Shown only in companion mode.
 */

const sectionClass = 'mt-8 border-t border-line pt-6';

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function useHealth(client: CompanionClient) {
  const [health, setHealth] = useState<CompanionHealth | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setHealth(await client.health());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const off = client.onEvent((e) => {
      if (e.type === 'workspace') void load();
    });
    return () => {
      clearTimeout(first);
      off();
    };
  }, [client, load]);
  return { health, failed, reload: load };
}

function Status({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${ok ? 'text-fg' : 'text-danger'}`}>
      {ok ? (
        <CheckCircle2 aria-hidden className="size-4 text-accent" />
      ) : (
        <CircleAlert aria-hidden className="size-4" />
      )}
      {ok ? good : bad}
    </span>
  );
}

export function CompanionAdmin({ client }: { client: CompanionClient }) {
  const { health, failed, reload } = useHealth(client);
  const [announcement, setAnnouncement] = useState('');
  return (
    <>
      <section aria-labelledby="health-heading" className={sectionClass}>
        <h2 id="health-heading" className="text-section font-semibold">
          Health
        </h2>
        {failed && !health && (
          <dl className="mt-2 text-sm">
            <div className="flex gap-3">
              <dt className="w-28 text-fg-muted">Companion</dt>
              <dd>
                <Status ok={false} good="Running" bad="Not running" />
              </dd>
            </div>
          </dl>
        )}
        {health && (
          <dl className="mt-2 grid gap-1.5 text-sm" aria-label="Health">
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">Companion</dt>
              <dd>
                <Status ok={!failed} good="Running" bad="Not running" />
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">Database</dt>
              <dd>
                <Status
                  ok={health.database.healthy}
                  good="Healthy"
                  bad={`Problem: ${health.database.detail}`}
                />
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">AI connection</dt>
              <dd>
                <Status ok={health.mcp.available} good="Available" bad="Unavailable" />
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-fg-muted">Workspace</dt>
              <dd>
                <Status
                  ok={health.workspace.healthy}
                  good="Healthy"
                  bad={`${health.workspace.conflicts.length} files you edited aren’t updated`}
                />
              </dd>
            </div>
          </dl>
        )}
        {health && (
          <Service
            client={client}
            health={health}
            onChanged={(text) => {
              setAnnouncement(text);
              void reload();
            }}
          />
        )}
      </section>
      <Checkpoints client={client} onChanged={setAnnouncement} />
      <Announcer message={announcement} />
    </>
  );
}

function Service({
  client,
  health,
  onChanged,
}: {
  client: CompanionClient;
  health: CompanionHealth;
  onChanged: (text: string) => void;
}) {
  const { autostart } = health;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [logs, setLogs] = useState<string[] | null>(null);

  async function setAutostart(enabled: boolean, restartOnFailure: boolean) {
    setBusy(true);
    setError(null);
    try {
      const status = await client.setAutostart(enabled, restartOnFailure);
      onChanged(
        status.enabled
          ? 'The companion will start when you log in.'
          : 'The companion won’t start by itself.',
      );
    } catch (e) {
      setError(messageOf(e, 'Couldn’t change that.'));
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setConfirmRestart(false);
    setRestarting(true);
    setError(null);
    try {
      await client.restart();
      onChanged('Restarting the companion; LOWTIDE reconnects by itself.');
    } catch (e) {
      setError(messageOf(e, 'Couldn’t restart the companion.'));
    } finally {
      setTimeout(() => setRestarting(false), 3000);
    }
  }

  return (
    <div className="mt-4 space-y-3 text-sm">
      {autostart.supported ? (
        <fieldset>
          <legend className={labelClass}>Running in the background</legend>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              disabled={busy}
              checked={autostart.enabled}
              onChange={(e) => void setAutostart(e.target.checked, autostart.restartOnFailure)}
            />
            <span>
              Start the companion when I log in
              <span className="block text-xs text-fg-muted">
                Takes effect at your next login. Nothing starts twice.
              </span>
            </span>
          </label>
          <label className="mt-1 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              disabled={busy || !autostart.enabled}
              checked={autostart.restartOnFailure}
              onChange={(e) => void setAutostart(true, e.target.checked)}
            />
            Restart it if it stops unexpectedly
          </label>
        </fieldset>
      ) : (
        <p className="text-fg-muted">
          Starting at login is set up on macOS only; elsewhere, start it with npm run companion.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {confirmRestart ? (
          <>
            <span>Restart the companion now? LOWTIDE pauses for a moment, then reconnects.</span>
            <Button size="sm" variant="primary" onClick={() => void restart()}>
              Yes, restart
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRestart(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={!health.restart || restarting}
            onClick={() => setConfirmRestart(true)}
          >
            <RotateCcw aria-hidden className="size-3.5" />
            {restarting ? 'Restarting…' : 'Restart companion'}
          </Button>
        )}
      </div>
      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && logs === null) {
            client.logs(200).then(
              (r) => setLogs(r.lines),
              () => setLogs([]),
            );
          }
        }}
      >
        <summary className="cursor-pointer text-fg-muted select-none">Companion log</summary>
        <pre
          aria-label="Companion log"
          className="mt-2 max-h-72 overflow-auto rounded-md bg-surface p-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all"
        >
          {logs === null ? 'Loading…' : logs.length ? logs.join('\n') : 'Nothing logged yet.'}
        </pre>
      </details>
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function Checkpoints({
  client,
  onChanged,
}: {
  client: CompanionClient;
  onChanged: (text: string) => void;
}) {
  const [list, setList] = useState<Checkpoint[] | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'restore' | 'remove' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const load = useCallback(async () => {
    try {
      setList(await client.checkpoints());
    } catch {
      setList([]);
    }
  }, [client]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
      onChanged(done);
      await load();
    } catch (e) {
      setError(messageOf(e, 'Couldn’t do that. Nothing changed.'));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  function take(event: FormEvent) {
    event.preventDefault();
    const label = name.trim() || 'Checkpoint';
    void act(() => client.createCheckpoint(label), `Checkpoint “${label}” taken.`).then(() =>
      setName(''),
    );
  }

  const now = new Date();
  return (
    <section aria-labelledby="checkpoints-heading" className={sectionClass}>
      <h2 id="checkpoints-heading" className="flex items-center gap-2 text-section font-semibold">
        <History aria-hidden className="size-5 text-fg-muted" /> Checkpoints
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        A checkpoint is a copy of everything at one moment. LOWTIDE takes one before large AI
        changes; you can take one too, and go back to any of them.
      </p>
      <form onSubmit={take} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <div>
          <label htmlFor={nameId} className={labelClass}>
            Name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={200}
            placeholder="Before reorganising SPACE"
            onChange={(e) => setName(e.target.value)}
            className={`${fieldClass} w-64 max-w-full`}
          />
        </div>
        <Button type="submit" disabled={busy}>
          Take checkpoint
        </Button>
      </form>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {list && list.length === 0 && (
        <p className="mt-3 text-sm text-fg-muted">No checkpoints yet.</p>
      )}
      {list && list.length > 0 && (
        <ul aria-label="Checkpoints" className="mt-3 divide-y divide-line text-sm">
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium break-words">{c.name}</span>
                <span className="block text-xs text-fg-muted">
                  <time dateTime={c.at} title={formatFull(c.at)}>
                    {formatWhen(c.at, now)}
                  </time>{' '}
                  · by {c.by} · {size(c.bytes)}
                </span>
              </span>
              {confirm?.id === c.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs">
                    {confirm.action === 'restore'
                      ? 'This replaces everything in LOWTIDE with this copy. A checkpoint of now is taken first.'
                      : 'Remove this checkpoint for good?'}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void (confirm.action === 'restore'
                        ? act(() => client.restoreCheckpoint(c.id), `Restored “${c.name}”.`)
                        : act(() => client.removeCheckpoint(c.id), `Removed “${c.name}”.`))
                    }
                  >
                    {confirm.action === 'restore'
                      ? `Yes, restore ${c.name}`
                      : `Yes, remove ${c.name}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Restore ${c.name}`}
                    onClick={() => setConfirm({ id: c.id, action: 'restore' })}
                  >
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => setConfirm({ id: c.id, action: 'remove' })}
                  >
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
