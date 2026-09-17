import { useMemo, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { capsulesFor, latestCapsule, thingsForProject } from '../lib/model.ts'
import { formatStamp, relativeDay } from '../lib/dates.ts'
import { href, navigate } from '../lib/router.ts'
import { Dialog, EmptyNote, Field, PageHeader, Quiet, SectionTitle, Tag } from '../components/ui.tsx'
import { CapsuleForm } from '../components/CapsuleForm.tsx'
import { ThingItem } from '../components/ThingItem.tsx'
import type { Capsule } from '../lib/types.ts'
import { nowMs } from '../lib/clock.ts'

export function ProjectDetail({ projectId }: { projectId: string }) {
  const store = useStore()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')

  const project = store.projects.find((p) => p.id === projectId)
  const history = useMemo(() => capsulesFor(store.capsules, projectId), [store.capsules, projectId])
  const capsule = latestCapsule(store.capsules, projectId)
  const things = thingsForProject(store.things, projectId)

  if (!project || project.deletedAt != null) {
    return (
      <div className="py-16 text-center">
        <h1 className="lt-display mb-3 text-3xl">That project is not here</h1>
        <p className="mb-6 text-sm text-muted">It may have been deleted on this device.</p>
        <a className="lt-btn lt-btn-secondary" href={href('/projects')}>
          All projects
        </a>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-4">
        <a className="lt-link text-xs" href={href('/projects')}>
          ← Projects
        </a>
      </p>

      <PageHeader
        eyebrow={capsule ? `Place saved ${formatStamp(capsule.savedAt)}` : 'No place saved yet'}
        title={project.name}
        actions={
          <>
            <button
              type="button"
              className="lt-btn lt-btn-secondary"
              onClick={() => {
                setName(project.name)
                setRenaming(true)
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="lt-btn lt-btn-secondary"
              onClick={() =>
                void store
                  .putProject({
                    ...project,
                    archivedAt: project.archivedAt ? null : nowMs(),
                    updatedAt: nowMs(),
                  })
                  .catch(() =>
                    toast.show('That could not be changed — nothing has moved.', { tone: 'problem' }),
                  )
              }
            >
              {project.archivedAt ? 'Unarchive' : 'Archive'}
            </button>
            <button
              type="button"
              className="lt-btn lt-btn-primary"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'Close' : capsule ? 'Update my place' : 'Save my place'}
            </button>
          </>
        }
      />

      {/* Resume ------------------------------------------------------ */}
      {capsule ? (
        <section className="lt-card lt-rise p-5 sm:p-7" aria-labelledby="resume-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="resume-heading" className="lt-eyebrow">
              Where you left it
            </h2>
            <p className="text-[0.7rem] text-muted">
              {formatStamp(capsule.savedAt)} · {relativeDay(capsule.savedAt)}
            </p>
          </div>

          {capsule.nextAction ? (
            <div className="mt-5 border-l-2 border-accent pl-4 sm:pl-5">
              <p className="lt-eyebrow mb-1.5">Start here</p>
              <p className="lt-prose text-[1.15rem] leading-snug sm:text-[1.35rem]">
                {capsule.nextAction}
              </p>
            </div>
          ) : (
            <Quiet className="mt-4">
              No next action was written down last time. Adding one takes a sentence and saves the
              worst part of coming back.
            </Quiet>
          )}

          <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Entry term="Status" value={capsule.status} />
            <Entry term="Last finished" value={capsule.lastCompleted} />
            <Entry term="In the way" value={capsule.blocker} tone="attention" />
            <Entry term="Last decision" value={capsule.lastDecision} />
          </dl>

          {capsule.notes ? (
            <div className="mt-6">
              <p className="lt-eyebrow mb-1.5">Notes</p>
              <p className="lt-prose text-[0.9375rem] text-muted">{capsule.notes}</p>
            </div>
          ) : null}

          {capsule.links.length > 0 ? (
            <div className="mt-6">
              <p className="lt-eyebrow mb-2">Links</p>
              <ul className="flex flex-wrap gap-2">
                {capsule.links.map((link) => (
                  <li key={link.id}>
                    <a
                      className="lt-tag hover:border-accent hover:text-accent-deep"
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {link.label || link.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-rule pt-5">
            <button type="button" className="lt-btn lt-btn-primary" onClick={() => setEditing(true)}>
              Update my place
            </button>
            <Quiet className="text-xs">
              Do the work first. Come back here before you stop, while you still remember.
            </Quiet>
          </div>
        </section>
      ) : (
        <EmptyNote>
          Nothing saved here yet. “Save my place” writes down where this stands so you do not have
          to reconstruct it next time.
        </EmptyNote>
      )}

      {savedAt ? (
        <p className="lt-fade mt-4 text-sm text-accent-deep" role="status">
          Your place is saved — {formatStamp(savedAt)}.
        </p>
      ) : null}

      {/* Save my place ---------------------------------------------- */}
      {editing ? (
        <section className="lt-card lt-rise mt-6 p-5 sm:p-7" aria-labelledby="capsule-form-heading">
          <h2 id="capsule-form-heading" className="lt-display mb-1 text-2xl">
            Save my place
          </h2>
          <Quiet className="mb-6">
            Write it for the person who comes back cold. Nothing here is required.
          </Quiet>
          <CapsuleForm
            projectId={projectId}
            previous={capsule}
            onSaved={(next) => {
              setSavedAt(next.savedAt)
              setEditing(false)
            }}
          />
        </section>
      ) : null}

      {/* Linked things ---------------------------------------------- */}
      <section className="mt-12">
        <SectionTitle count={things.length}>Things filed to this project</SectionTitle>
        {things.length === 0 ? (
          <Quiet>
            Nothing is filed here yet. In{' '}
            <a className="lt-link" href={href('/things')}>
              My Things
            </a>
            , open any item’s details and set “Part of”.
          </Quiet>
        ) : (
          <div className="lt-card px-4 sm:px-5">
            {things.map((thing) => (
              <ThingItem
                key={thing.id}
                thing={thing}
                onSave={(next) => store.putThing(next)}
                meta={thing.status === 'done' ? <Tag>Done</Tag> : null}
              />
            ))}
          </div>
        )}
      </section>

      {/* History ----------------------------------------------------- */}
      {history.length > 1 ? (
        <section className="mt-12">
          <SectionTitle count={history.length}>History</SectionTitle>
          <Quiet className="mb-4">
            Every save is kept. Nothing you wrote before has been overwritten.
          </Quiet>
          <ol className="grid gap-3">
            {history.slice(1).map((entry) => (
              <HistoryEntry key={entry.id} capsule={entry} />
            ))}
          </ol>
        </section>
      ) : null}

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename project"
        footer={
          <>
            <button type="button" className="lt-btn lt-btn-secondary" onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="lt-btn lt-btn-primary"
              disabled={!name.trim()}
              onClick={() => {
                void store
                  .putProject({ ...project, name: name.trim(), updatedAt: nowMs() })
                  .then(() => setRenaming(false))
                  .catch(() =>
                    toast.show('That could not be saved — the old name is unchanged.', {
                      tone: 'problem',
                    }),
                  )
              }}
            >
              Save
            </button>
          </>
        }
      >
        <Field label="Project name" htmlFor="rename-field">
          <input
            id="rename-field"
            className="lt-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </Dialog>

      <div className="mt-16 border-t border-rule pt-6">
        <button
          type="button"
          className="lt-btn lt-btn-quiet text-xs"
          onClick={() => {
            void store
              .softDeleteProject(project.id)
              .then(() => {
                toast.show(`“${project.name}” deleted.`, {
                  action: { label: 'Undo', run: () => store.restoreProject(project.id) },
                })
                navigate('/projects')
              })
              .catch(() => toast.show('That could not be deleted.', { tone: 'problem' }))
          }}
        >
          Delete this project
        </button>
        <p className="mt-1.5 text-xs text-muted">
          Its saved capsules stay in your data and come back if you undo.
        </p>
      </div>
    </div>
  )
}

function Entry({
  term,
  value,
  tone = 'calm',
}: {
  term: string
  value: string
  tone?: 'calm' | 'attention'
}) {
  if (!value) return null
  return (
    <div>
      <dt className="lt-eyebrow mb-1.5">{term}</dt>
      <dd className={`lt-prose text-[0.9375rem] ${tone === 'attention' ? 'text-attention' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function HistoryEntry({ capsule }: { capsule: Capsule }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="lt-card p-4">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-4 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm text-ink">{formatStamp(capsule.savedAt)}</span>
        <span className="text-xs text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <dl className="mt-4 grid gap-x-8 gap-y-4 border-t border-rule pt-4 sm:grid-cols-2">
          <Entry term="Status" value={capsule.status} />
          <Entry term="Last finished" value={capsule.lastCompleted} />
          <Entry term="In the way" value={capsule.blocker} />
          <Entry term="Last decision" value={capsule.lastDecision} />
          <Entry term="Next action" value={capsule.nextAction} />
          <Entry term="Notes" value={capsule.notes} />
        </dl>
      ) : null}
    </li>
  )
}
