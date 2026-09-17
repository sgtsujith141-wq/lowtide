import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { buildExport, exportFilename, previewImport, type ImportPreview } from '../lib/transfer.ts'
import { deleted } from '../lib/model.ts'
import { formatStamp } from '../lib/dates.ts'
import { Dialog, EmptyNote, PageHeader, Panel, Quiet, SectionTitle } from '../components/ui.tsx'

export function DataVault() {
  const store = useStore()
  const toast = useToast()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [pasted, setPasted] = useState('')
  const [importing, setImporting] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [estimate, setEstimate] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const bin = deleted(store.things)

  useEffect(() => {
    let cancelled = false
    async function read() {
      if (!('storage' in navigator)) return
      try {
        const [est, isPersisted] = await Promise.all([
          navigator.storage.estimate?.() ?? Promise.resolve(null),
          navigator.storage.persisted?.() ?? Promise.resolve(null),
        ])
        if (cancelled) return
        if (est?.usage != null) {
          const kb = est.usage / 1024
          setEstimate(kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`)
        }
        setPersisted(isPersisted)
      } catch {
        // Storage estimates are a nicety; their absence changes nothing.
      }
    }
    void read()
    return () => {
      cancelled = true
    }
  }, [store.things.length])

  function exportJson() {
    try {
      const payload = buildExport(store.snapshot())
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = exportFilename()
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.show('Backup written to your downloads.')
    } catch {
      toast.show('The backup could not be created in this browser.', { tone: 'problem' })
    }
  }

  function readText(text: string) {
    setPreview(previewImport(text, store.snapshot()))
  }

  async function onFile(file: File) {
    try {
      readText(await file.text())
    } catch {
      toast.show('That file could not be read.', { tone: 'problem' })
    }
  }

  async function applyImport() {
    if (!preview?.ok || importing) return
    setImporting(true)
    try {
      await store.importSnapshot(preview.incoming)
      const { things, projects, capsules, handoffs } = preview.counts
      toast.show(
        `Added ${things} thing${things === 1 ? '' : 's'}, ${projects} project${
          projects === 1 ? '' : 's'
        }, ${capsules} capsule${capsules === 1 ? '' : 's'}, ${handoffs} hand-off${
          handoffs === 1 ? '' : 's'
        }.`,
      )
      setPreview(null)
      setPasted('')
      if (fileInput.current) fileInput.current.value = ''
    } catch {
      toast.show('Nothing was imported — the write failed and your data is unchanged.', {
        tone: 'problem',
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Data"
        title="Your data, in your hands."
        lede="LOWTIDE keeps everything in this browser on this device. No account, no server, nothing sent anywhere."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Panel>
          <SectionTitle>Export</SectionTitle>
          <Quiet className="mb-4">
            A plain JSON file with every thing, project, capsule and hand-off. Keep it somewhere you
            trust.
          </Quiet>
          <button type="button" className="lt-btn lt-btn-primary" onClick={exportJson}>
            Download a backup
          </button>
          <dl className="mt-5 grid gap-1.5 text-xs text-muted">
            <div className="flex justify-between gap-4">
              <dt>Things</dt>
              <dd className="tabular-nums">{store.things.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Projects</dt>
              <dd className="tabular-nums">{store.projects.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Saved capsules</dt>
              <dd className="tabular-nums">{store.capsules.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Hand-offs</dt>
              <dd className="tabular-nums">{store.handoffs.length}</dd>
            </div>
            {estimate ? (
              <div className="flex justify-between gap-4">
                <dt>Space used by this site</dt>
                <dd className="tabular-nums">{estimate}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>

        <Panel>
          <SectionTitle>Import</SectionTitle>
          <Quiet className="mb-4">
            Nothing is written until you have seen exactly what will be added. An import never
            replaces or deletes what is already here.
          </Quiet>

          <label className="lt-label" htmlFor="import-file">
            Choose a backup file
          </label>
          <input
            id="import-file"
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="lt-field mb-4 file:mr-3 file:rounded file:border-0 file:bg-accent-wash file:px-3 file:py-1 file:text-xs file:text-accent-deep"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
            }}
          />

          <label className="lt-label" htmlFor="import-paste">
            Or paste JSON
          </label>
          <textarea
            id="import-paste"
            className="lt-field min-h-24 font-mono text-xs"
            placeholder='{"app":"lowtide", …} or an older lowtide.v1 backup'
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button
            type="button"
            className="lt-btn lt-btn-secondary mt-3"
            disabled={!pasted.trim()}
            onClick={() => readText(pasted)}
          >
            Check this
          </button>
        </Panel>
      </div>

      {preview ? (
        <Panel className="mt-6">
          <SectionTitle>What would be added</SectionTitle>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Row term="Format recognised">
              {preview.format === 'lowtide-v2'
                ? 'LOWTIDE backup'
                : preview.format === 'lowtide-v1'
                  ? 'Older LOWTIDE (v1) backup'
                  : 'Not recognised'}
            </Row>
            {preview.exportedAt ? (
              <Row term="Exported">{formatStamp(preview.exportedAt)}</Row>
            ) : null}
            <Row term="Things">{preview.counts.things}</Row>
            <Row term="Projects">{preview.counts.projects}</Row>
            <Row term="Capsules">{preview.counts.capsules}</Row>
            <Row term="Hand-offs">{preview.counts.handoffs}</Row>
            {preview.duplicates > 0 ? (
              <Row term="Already here (skipped)">{preview.duplicates}</Row>
            ) : null}
          </dl>

          {preview.problems.length > 0 ? (
            <div className="lt-inset mt-5 p-4">
              <p className="lt-eyebrow mb-2">What could not be read</p>
              <ul className="grid gap-1 text-xs text-muted">
                {preview.problems.slice(0, 12).map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
                {preview.problems.length > 12 ? (
                  <li>…and {preview.problems.length - 12} more.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="lt-btn lt-btn-primary"
              disabled={!preview.ok || importing}
              onClick={() => void applyImport()}
            >
              {importing ? 'Adding…' : 'Add this to my data'}
            </button>
            <button type="button" className="lt-btn lt-btn-quiet" onClick={() => setPreview(null)}>
              Cancel
            </button>
            {!preview.ok ? (
              <Quiet className="text-xs">
                There is nothing new to add from this file.
              </Quiet>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel className="mt-6">
        <SectionTitle>Coming from the older prototype</SectionTitle>
        <Quiet>
          An earlier LOWTIDE prototype kept its data under the browser key{' '}
          <code className="font-mono text-xs">lowtide.v1</code>. A page served from{' '}
          <code className="font-mono text-xs">file://</code> and this app are different origins as
          far as the browser is concerned, so this app cannot reach that data by itself — there is
          no way around that, and any app claiming otherwise would be guessing.
        </Quiet>
        <ol className="mt-4 grid list-decimal gap-2 pl-5 text-sm text-muted">
          <li>Open the old prototype in this browser.</li>
          <li>
            Use its own export if it has one. Otherwise open the developer console there and run{' '}
            <code className="font-mono text-xs">copy(localStorage.getItem('lowtide.v1'))</code>.
          </li>
          <li>Paste it into the box above and check it before adding.</li>
        </ol>
      </Panel>

      <section className="mt-10">
        <SectionTitle count={bin.length}>Deleted</SectionTitle>
        {bin.length === 0 ? (
          <EmptyNote>Nothing deleted. Deleted things wait here until you remove them.</EmptyNote>
        ) : (
          <ul className="grid gap-2">
            {bin.map((thing) => (
              <li
                key={thing.id}
                className="flex flex-wrap items-center gap-3 border-b border-rule py-3 last:border-b-0"
              >
                <p className="min-w-0 flex-1 text-sm text-muted line-through">{thing.text}</p>
                <span className="text-xs text-muted">
                  {thing.deletedAt ? formatStamp(thing.deletedAt) : ''}
                </span>
                <button
                  type="button"
                  className="lt-btn lt-btn-secondary text-xs"
                  onClick={() => void store.restoreThing(thing.id)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="lt-btn lt-btn-quiet text-xs"
                  onClick={() => void store.purgeThing(thing.id)}
                >
                  Remove for good
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Panel className="mt-10">
        <SectionTitle>This device</SectionTitle>
        <Quiet>
          Browsers can clear site data on their own — private windows, “clear browsing data”, and
          storage pressure all do it. Asking to keep the data makes that much less likely, and the
          answer below is the browser’s, not ours.
        </Quiet>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="lt-btn lt-btn-secondary"
            onClick={() => {
              void navigator.storage
                ?.persist?.()
                .then((granted) => {
                  setPersisted(granted)
                  toast.show(
                    granted
                      ? 'The browser agreed to keep this data.'
                      : 'The browser declined. Your data is still saved, but it can be cleared automatically.',
                  )
                })
                .catch(() =>
                  toast.show('This browser does not answer that question.', { tone: 'problem' }),
                )
            }}
          >
            Ask the browser to keep this data
          </button>
          <Quiet className="text-xs">
            {persisted == null
              ? 'Not asked yet.'
              : persisted
                ? 'The browser reports this data as persistent.'
                : 'The browser reports this data as clearable.'}
          </Quiet>
        </div>
      </Panel>

      <div className="mt-12 border-t border-rule pt-6">
        <button
          type="button"
          className="lt-btn lt-btn-quiet text-xs text-attention hover:bg-attention-wash hover:text-attention"
          onClick={() => setConfirmWipe(true)}
        >
          Delete everything on this device
        </button>
      </div>

      <Dialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Delete everything?"
        description="Every thing, project, capsule and hand-off stored in this browser will be removed. This cannot be undone, and there is no copy anywhere else."
        footer={
          <>
            <button
              type="button"
              className="lt-btn lt-btn-secondary"
              onClick={() => setConfirmWipe(false)}
            >
              Keep my data
            </button>
            <button
              type="button"
              className="lt-btn lt-btn-primary"
              onClick={() => {
                void store
                  .clearEverything()
                  .then(() => {
                    setConfirmWipe(false)
                    toast.show('Everything has been removed from this device.')
                  })
                  .catch(() =>
                    toast.show('Nothing was removed — the browser refused the write.', {
                      tone: 'problem',
                    }),
                  )
              }}
            >
              Delete everything
            </button>
          </>
        }
      >
        <Quiet>Download a backup first if there is any chance you will want this back.</Quiet>
      </Dialog>
    </div>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule py-1.5">
      <dt className="text-muted">{term}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}
