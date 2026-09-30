import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import type { BackupProblem, ValidatedBackup } from '../../db/repositories';
import { useCompanion } from '../../hooks/useCompanion';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import {
  readPersistence,
  requestPersistence,
  type PersistenceRequest,
  type PersistenceState,
} from '../../lib/storage-persistence';
import { describeSourceSchema } from './schema-label';
import { COUNT_ROWS } from './counts';
import { backupFileName, downloadText } from './download';

const PROBLEM_TEXT: Record<BackupProblem | 'unreadable', string> = {
  'not-json': 'That doesn’t look like a LOWTIDE backup.',
  'not-lowtide': 'That doesn’t look like a LOWTIDE backup.',
  'newer-format': 'This backup was created by a newer LOWTIDE version.',
  'newer-schema': 'This backup was created by a newer LOWTIDE version.',
  'invalid-data': 'That backup contains invalid data. Nothing was changed.',
  unreadable: 'Couldn’t read that file. Nothing was changed.',
};

const PERSISTENCE_TEXT: Record<PersistenceState | PersistenceRequest, string> = {
  persistent: 'Browser storage is marked persistent.',
  granted: 'Browser granted persistent storage.',
  'not-persistent':
    'Browser storage isn’t marked persistent, so under storage pressure the browser may clear it.',
  denied: 'Browser didn’t grant persistent storage. Keep backup files somewhere safe.',
  unsupported: 'This browser doesn’t expose persistent-storage controls.',
};

/**
 * Data & backup (ADR-031–034): export everything as a local JSON file,
 * restore from one (validate → preview → confirm → one atomic replace), and
 * see or request persistent browser storage. Nothing leaves the device.
 */
export function DataPage() {
  useDocumentTitle('Data & backup');
  const { backup } = useRepositories();
  const companion = useCompanion().backend.kind === 'companion';
  const counts = useWatch(backup.watchCounts);
  const id = useId();

  // Export
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);
  async function onExport() {
    setExportStatus(null);
    try {
      const doc = await backup.exportBackup();
      const name = backupFileName(new Date());
      downloadText(name, JSON.stringify(doc, null, 2));
      setExportStatus({ ok: true, text: `Downloaded ${name}.` });
    } catch {
      setExportStatus({ ok: false, text: 'Couldn’t create the backup. Nothing was changed.' });
    }
  }

  // Restore
  const [fileKey, setFileKey] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ backup: ValidatedBackup; fileName: string } | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const restoredStatus = useRef<HTMLParagraphElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (restored) restoredStatus.current?.focus();
  }, [restored]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setConfirmed(false);
    setFileError(null);
    setRestoreError(null);
    setRestored(null);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError(PROBLEM_TEXT.unreadable);
      return;
    }
    const result = backup.inspect(text);
    if (!result.ok) {
      setFileError(PROBLEM_TEXT[result.problem]);
      return;
    }
    setPreview({ backup: result.backup, fileName: file.name });
  }

  function reset() {
    setPreview(null);
    setConfirmed(false);
    setRestoreError(null);
    setFileKey((k) => k + 1);
  }

  async function onRestore() {
    if (!preview || !confirmed || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await backup.restore(preview.backup);
      const when = format(new Date(preview.backup.exportedAt), 'd MMM yyyy, HH:mm');
      reset();
      setRestored(`Backup restored. LOWTIDE now holds the data from ${when}.`);
    } catch {
      setRestoreError('Restore failed. Your existing LOWTIDE data is unchanged.');
    } finally {
      setRestoring(false);
    }
  }

  // Browser storage
  const [persistence, setPersistence] = useState<PersistenceState | PersistenceRequest | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    let active = true;
    void readPersistence().then((state) => active && setPersistence(state));
    return () => {
      active = false;
    };
  }, []);
  async function onPersist() {
    setAsking(true);
    const result = await requestPersistence();
    setPersistence(result === 'denied' ? 'denied' : result);
    setAsking(false);
  }

  const current = counts.status === 'ready' ? counts.data : null;

  return (
    <>
      <h1 className="font-serif text-xl font-semibold tracking-tight">Data &amp; backup</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {companion
          ? 'LOWTIDE is local-first. Your data lives in the LOWTIDE companion’s database on this computer (see Settings); backups and restores work the same way.'
          : 'LOWTIDE is local-first. Your data lives in this browser unless you export a copy.'}
      </p>

      <section aria-labelledby={`${id}-backup`} className="mt-6">
        <h2
          id={`${id}-backup`}
          className="border-b border-line pb-1.5 text-sm font-medium text-ink-muted"
        >
          Backup
        </h2>
        <p className="mt-2 text-sm">Export a copy of everything in LOWTIDE as a JSON file.</p>
        <p className="mt-1 text-sm text-ink-muted">
          <strong className="font-medium text-ink">Backup files are not encrypted.</strong> Anyone
          with the file can read everything in it: tasks, notes, protected time, rhythms and
          hackathons. Keep it somewhere you trust.
        </p>
        <Button variant="quiet" onClick={() => void onExport()} className="mt-3">
          <Download aria-hidden className="size-4" />
          Download backup
        </Button>
        {/* Always present so screen readers announce the text when it arrives. */}
        <p role="status" className="mt-2 min-h-5 text-sm text-ink-muted">
          {exportStatus?.ok ? exportStatus.text : ''}
        </p>
        {exportStatus && !exportStatus.ok && <ErrorNotice>{exportStatus.text}</ErrorNotice>}
      </section>

      <section aria-labelledby={`${id}-restore`} className="mt-7">
        <h2
          id={`${id}-restore`}
          className="border-b border-line pb-1.5 text-sm font-medium text-ink-muted"
        >
          Restore
        </h2>
        <p className="mt-2 text-sm">
          Restoring replaces everything LOWTIDE holds in this browser with the backup. You’ll see
          what’s in the file before anything changes.
        </p>
        <label htmlFor={`${id}-file`} className="mt-3 block text-sm font-medium">
          Choose a LOWTIDE backup file
        </label>
        <input
          key={fileKey}
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void onFile(e)}
          aria-describedby={fileError ? `${id}-file-error` : undefined}
          aria-invalid={fileError ? true : undefined}
          className="mt-1 block w-full max-w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-paper-raised file:px-2.5 file:py-1 file:text-sm file:text-ink"
        />
        {fileError && <ErrorNotice id={`${id}-file-error`}>{fileError}</ErrorNotice>}

        {restored && (
          <p
            ref={restoredStatus}
            tabIndex={-1}
            role="status"
            className="mt-3 text-sm font-medium text-accent-ink"
          >
            {restored}
          </p>
        )}

        {preview && (
          <div className="mt-4 rounded-md border border-line bg-paper-raised p-3">
            <h3 ref={previewHeading} tabIndex={-1} className="font-medium">
              Backup from {format(new Date(preview.backup.exportedAt), 'd MMM yyyy, HH:mm')}
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              {preview.fileName} · {describeSourceSchema(preview.backup.sourceSchemaVersion)}
            </p>
            <table className="mt-3 w-full max-w-sm text-sm">
              <caption className="sr-only">Records in the backup and in this browser now</caption>
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th scope="col" className="py-1 font-normal">
                    <span className="sr-only">Kind</span>
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    In the backup
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    Now in this browser
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {COUNT_ROWS.map(({ key, label }) => (
                  <tr key={key} className="border-t border-line">
                    <th scope="row" className="py-1 text-left font-normal">
                      {label}
                    </th>
                    <td className="py-1 text-right">{preview.backup.counts[key]}</td>
                    <td className="py-1 text-right text-ink-muted">
                      {current ? current[key] : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm">
              Importing this backup will replace the LOWTIDE data currently stored in this browser.
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 size-4 accent-(--lt-accent-ink)"
              />
              I understand this replaces the LOWTIDE data in this browser.
            </label>
            {restoreError && <ErrorNotice>{restoreError}</ErrorNotice>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => void onRestore()}
                disabled={!confirmed || restoring}
              >
                {restoring ? 'Restoring…' : 'Restore backup'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  reset();
                  requestAnimationFrame(() => document.getElementById(`${id}-file`)?.focus());
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {!companion && (
        <section aria-labelledby={`${id}-storage`} className="mt-7">
          <h2
            id={`${id}-storage`}
            className="border-b border-line pb-1.5 text-sm font-medium text-ink-muted"
          >
            Browser storage
          </h2>
          {persistence && (
            <p role="status" className="mt-2 text-sm">
              {PERSISTENCE_TEXT[persistence]}
            </p>
          )}
          {(persistence === 'not-persistent' || persistence === 'denied') && (
            <Button
              variant="quiet"
              onClick={() => void onPersist()}
              disabled={asking}
              className="mt-2"
            >
              Ask browser to keep LOWTIDE data
            </Button>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            Persistent storage only makes the browser less likely to clear LOWTIDE when space runs
            low. It doesn’t survive clearing site data, deleting the browser profile or losing the
            device, so backups still matter.
          </p>
        </section>
      )}
    </>
  );
}
