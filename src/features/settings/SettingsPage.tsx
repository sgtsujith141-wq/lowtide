import { CheckCircle2, CircleAlert, HardDrive, Monitor, Moon, Server, Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { connectCompanion, switchBackend } from '../../app/companion-context';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { DEFAULT_COMPANION_URL, companionUrl, pairingFromHash } from '../../db/companion/backend';
import {
  CompanionAuthError,
  CompanionUnavailableError,
  type CompanionClient,
} from '../../db/companion/client';
import type { CompanionStatus, MigrationReport } from '../../db/companion/wire';
import type { BackupCounts } from '../../db/repositories';
import { useCompanion, useCompanionConnection } from '../../hooks/useCompanion';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { readTheme, saveTheme, type Theme } from '../../lib/theme';
import { COUNT_ROWS } from '../backup/counts';
import { backupFileName, downloadText } from '../backup/download';
import { CompanionAdmin } from './CompanionAdmin';

const THEME_OPTIONS: { value: Theme; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'auto', label: 'Auto', hint: 'Follows your system', icon: Monitor },
  { value: 'light', label: 'Light', hint: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
];

const sectionClass = 'mt-8 border-t border-line pt-6';

/**
 * Settings (ADR-058, ADR-061; compact since v2 PHASE 016): appearance, where
 * the data lives, backup, privacy, and, set apart, the advanced switch back
 * to browser storage.
 */
export function SettingsPage() {
  useDocumentTitle('Settings');
  const { backend, client } = useCompanion();
  return (
    <>
      <h1 className="text-page font-semibold">Settings</h1>
      <Appearance />
      <Storage />
      {backend.kind === 'companion' && client && <CompanionAdmin client={client} />}
      <section aria-labelledby="backup-heading" className={sectionClass}>
        <h2 id="backup-heading" className="text-section font-semibold">
          Backup
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Download everything as one file, or restore one, in{' '}
          <Link to="/data" className="text-accent-ink underline underline-offset-2">
            Data &amp; backup
          </Link>
          .
        </p>
      </section>
      <section aria-labelledby="privacy-heading" className={sectionClass}>
        <h2 id="privacy-heading" className="text-section font-semibold">
          Privacy
        </h2>
        <ul className="mt-1 space-y-1 text-sm text-fg-muted">
          <li>Everything stays on this computer; LOWTIDE sends nothing anywhere.</li>
          <li>
            AI clients see only what you grant them, in{' '}
            <Link to="/ai" className="text-accent-ink underline underline-offset-2">
              AI
            </Link>
            .
          </li>
          <li>Protected time is never available to AI, from any grant.</li>
        </ul>
      </section>
      {backend.kind === 'companion' && (
        <section aria-labelledby="advanced-heading" className={`${sectionClass} border-danger/30`}>
          <h2 id="advanced-heading" className="text-section font-semibold">
            Advanced
          </h2>
          <BrowserSwitch />
        </section>
      )}
    </>
  );
}

function Appearance() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const name = useId();
  return (
    <section aria-labelledby="appearance-heading" className={sectionClass}>
      <h2 id="appearance-heading" className="text-section font-semibold">
        Appearance
      </h2>
      <fieldset className="mt-2">
        <legend className={labelClass}>Theme</legend>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-canvas"
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={theme === value}
                onChange={() => {
                  setTheme(value);
                  saveTheme(value);
                }}
              />
              <Icon aria-hidden className="size-4 text-fg-muted" />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-fg-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function Storage() {
  const { backend } = useCompanion();
  return (
    <section aria-labelledby="storage-heading" className={sectionClass}>
      <h2 id="storage-heading" className="flex items-center gap-2 text-section font-semibold">
        {backend.kind === 'companion' ? (
          <Server aria-hidden className="size-5 text-fg-muted" />
        ) : (
          <HardDrive aria-hidden className="size-5 text-fg-muted" />
        )}
        Data &amp; companion
      </h2>
      {backend.kind === 'companion' ? <OnCompanion /> : <MoveToCompanion />}
    </section>
  );
}

/* ------------------------------ companion mode ------------------------------ */

function OnCompanion() {
  const { backend, client } = useCompanion();
  const connection = useCompanionConnection();
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!client || connection !== 'open') return;
    let active = true;
    client.status().then(
      (s) => active && setStatus(s),
      () => active && setProblem('Couldn’t read the companion’s status.'),
    );
    return () => {
      active = false;
    };
  }, [client, connection]);

  if (backend.kind !== 'companion') return null;
  const total = status ? Object.values(status.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="mt-2 space-y-3 text-sm">
      <p>
        Your data lives in the <strong>LOWTIDE companion</strong> on this computer (
        {backend.url.replace('http://', '')}).
      </p>
      <p className="flex items-center gap-2" role="status">
        {connection === 'open' ? (
          <>
            <CheckCircle2 aria-hidden className="size-4 text-accent" /> Connected
          </>
        ) : connection === 'retrying' ? (
          <>
            <CircleAlert aria-hidden className="size-4 text-danger" /> Can’t reach it. Start it with{' '}
            <code>npm run companion</code>.
          </>
        ) : (
          'Connecting…'
        )}
      </p>
      {problem && <ErrorNotice>{problem}</ErrorNotice>}
      {status && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
          <dt className="text-fg-muted">Records</dt>
          <dd>{total}</dd>
          <dt className="text-fg-muted">Database</dt>
          <dd className="break-all">{status.database}</dd>
          <dt className="text-fg-muted">Workspace</dt>
          <dd className="break-all">{status.workspaceDir}</dd>
          <dt className="text-fg-muted">Moved in</dt>
          <dd>
            {status.migration
              ? new Date(status.migration.migratedAt).toLocaleString()
              : 'Not moved from a browser (started empty)'}
          </dd>
          <dt className="text-fg-muted">Companion</dt>
          <dd>
            version {status.version}, schema {status.schemaVersion}
          </dd>
        </dl>
      )}
    </div>
  );
}

/** Switching back to browser storage: deliberate, and set apart. */
function BrowserSwitch() {
  const { switchTo = switchBackend } = useCompanion();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="mt-2 text-sm">
      <div className="rounded-lg border border-danger/40 p-3">
        <h3 className="font-medium">Go back to this browser’s storage</h3>
        <p className="mt-1 text-fg-muted">
          This browser still holds LOWTIDE as it was when you moved, untouched. Anything changed
          since then is only in the companion: to take it with you,{' '}
          <Link to="/data" className="text-accent-ink underline underline-offset-2">
            download a backup
          </Link>{' '}
          first and restore it after switching. The companion keeps its data either way.
        </p>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I understand changes made in the companion don’t come back by themselves
        </label>
        <Button className="mt-2" disabled={!confirm} onClick={() => switchTo({ kind: 'browser' })}>
          Use this browser’s storage
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------- browser mode ------------------------------- */

type Step =
  | { kind: 'pair' }
  | { kind: 'paired'; client: CompanionClient; status: CompanionStatus }
  | { kind: 'migrated'; client: CompanionClient; report: MigrationReport };

function MoveToCompanion() {
  const { backup } = useRepositories();
  const { connect = connectCompanion, switchTo = switchBackend } = useCompanion();
  const ids = { url: useId(), token: useId() };
  const location = useLocation();
  const navigate = useNavigate();
  // A pairing link (`npm run companion -- pair`) fills the form…
  const [pairing] = useState(() => pairingFromHash(location.hash));
  const [url, setUrl] = useState(pairing?.url ?? DEFAULT_COMPANION_URL);
  const [token, setToken] = useState(pairing?.token ?? '');
  const [step, setStep] = useState<Step>({ kind: 'pair' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ name: string; text: string; counts: BackupCounts } | null>(
    null,
  );
  const [haveFile, setHaveFile] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const reportHeading = useRef<HTMLHeadingElement>(null);

  // …and then leaves the address bar, so the token isn't kept in history.
  useEffect(() => {
    if (pairing) void navigate(location.pathname, { replace: true });
  }, [pairing, navigate, location.pathname]);

  useEffect(() => {
    if (step.kind === 'migrated') reportHeading.current?.focus();
  }, [step.kind]);

  async function pair(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const address = companionUrl(url);
    if (!address) {
      setError('Use the companion’s address on this computer, like http://127.0.0.1:4318.');
      return;
    }
    if (token.trim().length < 32) {
      setError('Paste the owner token from the pairing link (npm run companion -- pair).');
      return;
    }
    setBusy(true);
    try {
      const client = connect({ url: address, token: token.trim() });
      const status = await client.status();
      setStep({ kind: 'paired', client, status });
      setAnnouncement('Paired with the LOWTIDE companion.');
    } catch (e) {
      setError(
        e instanceof CompanionAuthError
          ? 'The companion didn’t accept that token. Run npm run companion -- pair for a fresh link.'
          : e instanceof CompanionUnavailableError
            ? `No companion answered at ${address}. Start it with npm run companion.`
            : 'Couldn’t pair with the companion.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveBackup() {
    setError(null);
    try {
      const doc = await backup.exportBackup();
      const text = JSON.stringify(doc, null, 2);
      // The same check a restore preview runs: prove the file is complete and valid.
      const inspection = backup.inspect(text);
      if (!inspection.ok) {
        setError('The backup didn’t pass its own check, so nothing will be moved.');
        return;
      }
      const name = backupFileName(new Date());
      downloadText(name, text);
      setSaved({ name, text, counts: inspection.backup.counts });
      setAnnouncement(`Downloaded ${name} and checked it.`);
    } catch {
      setError('Couldn’t create the backup. Nothing was moved.');
    }
  }

  async function migrate() {
    if (step.kind !== 'paired' || !saved || !haveFile) return;
    setBusy(true);
    setError(null);
    try {
      const report = await step.client.migrate(saved.text);
      setStep({ kind: 'migrated', client: step.client, report });
    } catch {
      setError('The companion couldn’t be reached, so nothing was moved.');
    } finally {
      setBusy(false);
    }
  }

  const address = companionUrl(url) ?? DEFAULT_COMPANION_URL;

  return (
    <div className="mt-2 space-y-4 text-sm">
      <p>
        <strong>This browser</strong> (IndexedDB). LOWTIDE can move into the{' '}
        <strong>LOWTIDE companion</strong>, a small program on this computer that keeps your data in
        SQLite, keeps a technical workspace up to date, and lets the AI clients you choose read and
        change it within limits you set. Nothing goes to the internet. Your browser’s copy is never
        deleted.
      </p>

      <ol className="list-decimal space-y-4 pl-5">
        <li>
          <h3 className="font-medium">Start and pair the companion</h3>
          <p className="text-fg-muted">
            In the LOWTIDE folder run <code>npm run companion</code>, then{' '}
            <code>npm run companion -- pair</code> and open the link it prints.
          </p>
          {step.kind === 'pair' ? (
            <form
              aria-label="Pair with the companion"
              onSubmit={(e) => void pair(e)}
              className="mt-2 grid max-w-lg gap-2"
            >
              <div>
                <label htmlFor={ids.url} className={labelClass}>
                  Companion address
                </label>
                <input
                  id={ids.url}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className={fieldClass}
                  inputMode="url"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor={ids.token} className={labelClass}>
                  Owner token
                </label>
                <input
                  id={ids.token}
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className={fieldClass}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={busy}
                className="justify-self-start"
              >
                Pair
              </Button>
            </form>
          ) : (
            <p className="mt-1 flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 text-accent" /> Paired with the companion
              at {address.replace('http://', '')}.
            </p>
          )}
        </li>

        {step.kind === 'paired' && !step.status.empty && (
          <li>
            <h3 className="font-medium">The companion already holds LOWTIDE data</h3>
            <p className="text-fg-muted">
              {Object.values(step.status.counts).reduce((a, b) => a + b, 0)} records
              {step.status.migration
                ? `, moved in on ${new Date(step.status.migration.migratedAt).toLocaleString()}`
                : ''}
              . Moving again would mix two copies, so it isn’t offered. You can switch to the
              companion’s data as it is; this browser’s data stays here, untouched, and isn’t
              merged.
            </p>
            <Button
              className="mt-2"
              onClick={() => switchTo({ kind: 'companion', url: address, token: token.trim() })}
            >
              Use the companion’s data
            </Button>
          </li>
        )}

        {step.kind !== 'pair' && (step.kind === 'migrated' || step.status.empty) && (
          <>
            <li>
              <h3 className="font-medium">Save a backup first</h3>
              <p className="text-fg-muted">
                A complete backup file of this browser’s LOWTIDE, checked the same way a restore is,
                is required before anything moves.
              </p>
              {saved ? (
                <div className="mt-2">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 aria-hidden className="size-4 text-accent" /> Saved and checked{' '}
                    {saved.name}
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-fg-muted">What’s in it</summary>
                    <table className="mt-1 text-xs">
                      <tbody>
                        {COUNT_ROWS.map(({ key, label }) => (
                          <tr key={key}>
                            <th scope="row" className="pr-4 text-left font-normal text-fg-muted">
                              {label}
                            </th>
                            <td className="text-right tabular-nums">{saved.counts[key]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              ) : (
                <Button className="mt-2" onClick={() => void saveBackup()}>
                  Download a backup
                </Button>
              )}
            </li>
            <li>
              <h3 className="font-medium">Move LOWTIDE into the companion</h3>
              <p className="text-fg-muted">
                The companion checks the backup again, copies every record with its id, compares the
                copy with the backup record by record, and keeps an exact copy of the file. If
                anything differs, nothing is kept.
              </p>
              {step.kind === 'paired' && (
                <>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={haveFile}
                      disabled={!saved}
                      onChange={(e) => setHaveFile(e.target.checked)}
                    />
                    I have the backup file somewhere safe
                  </label>
                  <Button
                    variant="primary"
                    className="mt-2"
                    disabled={!saved || !haveFile || busy}
                    onClick={() => void migrate()}
                  >
                    Move LOWTIDE into the companion
                  </Button>
                </>
              )}
            </li>
          </>
        )}
      </ol>

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {step.kind === 'migrated' && (
        <MigrationResult
          report={step.report}
          headingRef={reportHeading}
          onSwitch={() => switchTo({ kind: 'companion', url: address, token: token.trim() })}
        />
      )}
      <Announcer message={announcement} />
    </div>
  );
}

function MigrationResult({
  report,
  headingRef,
  onSwitch,
}: {
  report: MigrationReport;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSwitch: () => void;
}) {
  const labels = new Map(COUNT_ROWS.map((r) => [r.key, r.label]));
  return (
    <div className="rounded-lg border border-line p-3">
      <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">
        {report.ok ? 'Moved and verified' : 'Nothing was moved'}
      </h3>
      {!report.ok && <p className="mt-1 text-danger">{report.problem}</p>}
      {report.stores.length > 0 && (
        <table className="mt-2 text-xs">
          <caption className="sr-only">Records per store</caption>
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="pr-4 text-left font-normal">
                Store
              </th>
              <th scope="col" className="pr-4 text-right font-normal">
                Backup
              </th>
              <th scope="col" className="text-right font-normal">
                Companion
              </th>
            </tr>
          </thead>
          <tbody>
            {report.stores.map((s) => (
              <tr key={s.store}>
                <th scope="row" className="pr-4 text-left font-normal">
                  {labels.get(s.store) ?? s.store}
                </th>
                <td className="pr-4 text-right tabular-nums">{s.backup}</td>
                <td className="text-right tabular-nums">{s.companion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="mt-2 space-y-0.5 text-xs" aria-label="Checks">
        {report.checks.map((c) => (
          <li key={c.name} className="flex items-center gap-1.5">
            {c.ok ? (
              <CheckCircle2 aria-hidden className="size-3.5 text-accent" />
            ) : (
              <CircleAlert aria-hidden className="size-3.5 text-danger" />
            )}
            <span>
              {c.name}
              {c.detail ? `: ${c.detail}` : ''}
              <span className="sr-only">{c.ok ? ' (passed)' : ' (failed)'}</span>
            </span>
          </li>
        ))}
      </ul>
      {report.savedCopy && (
        <p className="mt-2 text-xs text-fg-muted">
          The companion kept an exact copy at <code className="break-all">{report.savedCopy}</code>.
        </p>
      )}
      {report.ok && (
        <>
          <p className="mt-2">
            Your browser’s copy stays here, untouched. Switch when you’re ready: from then on,
            LOWTIDE reads and saves through the companion.
          </p>
          <Button variant="primary" className="mt-2" onClick={onSwitch}>
            Switch to the companion
          </Button>
        </>
      )}
    </div>
  );
}
