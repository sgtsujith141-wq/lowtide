import { useMemo, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { capsulesFor, latestCapsule, thingsForProject } from '../lib/model.ts'
import { formatStamp, relativeDay } from '../lib/dates.ts'
import { nowMs, useNow } from '../lib/clock.ts'
import { href, navigate } from '../lib/router.ts'
import { Dialog, Empty, Field, Panel, Quiet, SectionHead } from '../components/ui.tsx'
import { CapsuleForm } from '../components/CapsuleForm.tsx'
import { ThoughtRow } from '../components/ThoughtRow.tsx'
import { Icon } from '../components/Icon.tsx'
import type { Capsule } from '../lib/types.ts'

export function ProjectDetail({ projectId }: { projectId: string }) {
  const store = useStore()
  const toast = useToast()
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const project = store.projects.find((p) => p.id === projectId)
  const history = useMemo(() => capsulesFor(store.capsules, projectId), [store.capsules, projectId])
  const capsule = latestCapsule(store.capsules, projectId)
  const things = thingsForProject(store.things, projectId)

  if (!project || project.deletedAt != null) {
    return (
      <div className="py-14 text-center">
        <h1 className="display mb-2 text-2xl">That project is not here</h1>
        <Quiet className="mb-5">It may have been deleted on this device.</Quiet>
        <a className="btn btn-soft" href={href('/projects')}>
          All projects
        </a>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-3">
        <a className="link text-[0.75rem]" href={href('/projects')}>
          ← Projects
        </a>
      </p>

      <header className="rise mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-[1.75rem]">{project.name}</h1>
          {project.description ? (
            <p className="mt-1 text-[0.875rem] leading-relaxed text-muted">{project.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setName(project.name)
              setDescription(project.description)
              setDetailsOpen(true)
            }}
          >
            Edit details
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void store
                .putProject({
                  ...project,
                  archivedAt: project.archivedAt ? null : nowMs(),
                  updatedAt: nowMs(),
                })
                .catch(() => toast.show('That could not be changed.', { tone: 'problem' }))
            }
          >
            {project.archivedAt ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" className="btn btn-solid" onClick={() => setEditing((v) => !v)}>
            <Icon name="plus" className="size-4" />
            {editing ? 'Close' : capsule ? 'Save my place' : 'Save my place'}
          </button>
        </div>
      </header>

      {/* Where you left off ------------------------------------------ */}
      {capsule ? (
        <Panel className="rise !p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-[1.25rem]">Here’s where you left off.</h2>
            <p className="text-[0.7rem] text-muted">
              saved {formatStamp(capsule.savedAt)} · {relativeDay(capsule.savedAt, now)}
            </p>
          </div>

          {capsule.nextAction ? (
            <div className="mt-4 border-l-2 border-forest pl-4">
              <p className="eyebrow mb-1">Start here</p>
              <p className="written text-[1.15rem] leading-snug">{capsule.nextAction}</p>
            </div>
          ) : (
            <Quiet className="mt-3">
              No next action was written last time. One sentence here saves the worst part of coming
              back.
            </Quiet>
          )}

          <dl className="mt-5 grid gap-x-7 gap-y-4 sm:grid-cols-2">
            <Entry term="Where it stands" value={capsule.status} />
            <Entry term="Last finished" value={capsule.lastCompleted} />
            <Entry term="In the way" value={capsule.blocker} tone="brown" />
            <Entry term="Last decision" value={capsule.lastDecision} />
          </dl>

          {capsule.notes ? (
            <div className="mt-5">
              <p className="eyebrow mb-1">Notes</p>
              <p className="written text-[0.9375rem] text-muted">{capsule.notes}</p>
            </div>
          ) : null}

          {capsule.links.length > 0 ? (
            <div className="mt-5">
              <p className="eyebrow mb-1.5">Links</p>
              <ul className="flex flex-wrap gap-1.5">
                {capsule.links.map((link) => (
                  <li key={link.id}>
                    <a
                      className="chip hover:border-forest hover:text-forest-deep"
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

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button type="button" className="btn btn-soft" onClick={() => setEditing(true)}>
              Update where I am
            </button>
            <Quiet className="text-[0.75rem]">
              Do the work first. Come back here before you stop, while you still remember.
            </Quiet>
          </div>
        </Panel>
      ) : (
        <Empty>
          Nothing saved here yet. “Save my place” writes down where this stands so you do not have
          to reconstruct it next time.
        </Empty>
      )}

      {savedAt ? (
        <p className="fade mt-3 text-[0.8125rem] text-forest-deep" role="status">
          Your place is saved — {formatStamp(savedAt)}.
        </p>
      ) : null}

      {/* Save my place ------------------------------------------------ */}
      {editing ? (
        <Panel className="rise mt-4 !p-5">
          <h2 className="display mb-1 text-[1.25rem]">Save my place</h2>
          <Quiet className="mb-4">
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
        </Panel>
      ) : null}

      {/* Things ------------------------------------------------------- */}
      <section className="mt-8">
        <SectionHead count={things.length}>Filed to this project</SectionHead>
        {things.length === 0 ? (
          <Quiet>
            Nothing filed here yet. On any thought, use its ⋯ menu and “Add to a project”.
          </Quiet>
        ) : (
          <Panel className="!py-1">
            {things.map((thing) => (
              <ThoughtRow key={thing.id} thing={thing} />
            ))}
          </Panel>
        )}
      </section>

      {/* History ------------------------------------------------------ */}
      {history.length > 1 ? (
        <section className="mt-8">
          <SectionHead count={history.length}>Earlier places</SectionHead>
          <Quiet className="mb-2.5">
            Every save is kept. Nothing you wrote before has been overwritten.
          </Quiet>
          <ol className="grid gap-2">
            {history.slice(1).map((entry) => (
              <HistoryEntry key={entry.id} capsule={entry} />
            ))}
          </ol>
        </section>
      ) : null}

      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Project details"
        footer={
          <>
            <button type="button" className="btn btn-soft" onClick={() => setDetailsOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-solid"
              disabled={!name.trim()}
              onClick={() => {
                void store
                  .putProject({
                    ...project,
                    name: name.trim(),
                    description: description.trim(),
                    updatedAt: nowMs(),
                  })
                  .then(() => setDetailsOpen(false))
                  .catch(() =>
                    toast.show('That could not be saved — nothing has changed.', { tone: 'problem' }),
                  )
              }}
            >
              Save
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Name" htmlFor="rename-field">
            <input
              id="rename-field"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="What it is" htmlFor="redescribe-field">
            <input
              id="redescribe-field"
              className="field"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <div className="mt-12 border-t border-line pt-5">
        <button
          type="button"
          className="btn btn-ghost"
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
        <Quiet className="mt-1 text-[0.7rem]">
          Its saved places stay in your data and come back if you undo.
        </Quiet>
      </div>
    </div>
  )
}

function Entry({
  term,
  value,
  tone = 'ink',
}: {
  term: string
  value: string
  tone?: 'ink' | 'brown'
}) {
  if (!value) return null
  return (
    <div>
      <dt className="eyebrow mb-1">{term}</dt>
      <dd className={`written text-[0.9375rem] ${tone === 'brown' ? 'text-brown' : ''}`}>{value}</dd>
    </div>
  )
}

function HistoryEntry({ capsule }: { capsule: Capsule }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="paper p-3">
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-4 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[0.8125rem]">{formatStamp(capsule.savedAt)}</span>
        <span className="text-[0.7rem] text-muted">{open ? 'hide' : 'show'}</span>
      </button>
      {open ? (
        <dl className="mt-3 grid gap-x-7 gap-y-3 border-t border-line pt-3 sm:grid-cols-2">
          <Entry term="Where it stood" value={capsule.status} />
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
