import { useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { latestCapsule, thingsForProject } from '../lib/model.ts'
import { formatStamp, relativeDay } from '../lib/dates.ts'
import { href, navigate } from '../lib/router.ts'
import { EmptyNote, PageHeader, Quiet, SectionTitle, Tag } from '../components/ui.tsx'
import type { Project } from '../lib/types.ts'

export function Projects() {
  const store = useStore()
  const toast = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const live = store.projects
    .filter((p) => p.deletedAt == null && p.archivedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const archived = store.projects
    .filter((p) => p.deletedAt == null && p.archivedAt != null)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const project = await store.createProject(name)
      setName('')
      navigate(`/projects/${project.id}`)
    } catch {
      toast.show('That project could not be saved — the name is still in the field.', {
        tone: 'problem',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Projects"
        title="The black box."
        lede="One capsule per project, holding the context you would otherwise have to rebuild: where it stands, what stopped you, and the exact next move."
      />

      <form onSubmit={create} className="lt-card mb-10 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
        <div className="flex-1">
          <label className="lt-label" htmlFor="project-name">
            Start a project
          </label>
          <input
            id="project-name"
            className="lt-field"
            placeholder="Harrow deck, kitchen rewire, Q3 hiring…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="lt-btn lt-btn-primary" disabled={!name.trim() || busy}>
          Create
        </button>
      </form>

      {live.length === 0 ? (
        <EmptyNote>No projects yet. A project earns its place when it needs a memory.</EmptyNote>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {live.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <section className="mt-12">
          <SectionTitle count={archived.length}>Archived</SectionTitle>
          <div className="grid gap-3">
            {archived.map((project) => (
              <div
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3"
              >
                <a className="lt-link lt-display text-lg" href={href(`/projects/${project.id}`)}>
                  {project.name}
                </a>
                <Quiet>
                  {project.archivedAt ? `Archived ${relativeDay(project.archivedAt)}` : 'Archived'}
                </Quiet>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const store = useStore()
  const capsule = latestCapsule(store.capsules, project.id)
  const openThings = thingsForProject(store.things, project.id).filter((t) => t.status === 'open')

  return (
    <article className="lt-card flex flex-col p-5 transition-shadow hover:shadow-[var(--shadow-lift)]">
      <h2 className="lt-display text-xl">
        <a className="hover:text-accent-deep" href={href(`/projects/${project.id}`)}>
          {project.name}
        </a>
      </h2>

      {capsule ? (
        <>
          {capsule.status ? <p className="mt-2 text-sm leading-relaxed text-muted">{capsule.status}</p> : null}
          {capsule.nextAction ? (
            <div className="lt-inset mt-4 px-3 py-2.5">
              <p className="lt-eyebrow mb-1">Next</p>
              <p className="lt-prose text-[0.9375rem]">{capsule.nextAction}</p>
            </div>
          ) : null}
          <p className="mt-4 text-[0.7rem] text-muted">Place saved {formatStamp(capsule.savedAt)}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          No context saved yet. Open it and save your place before you stop.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {capsule?.blocker ? <Tag tone="attention">Blocked</Tag> : null}
        {openThings.length > 0 ? (
          <Tag>
            {openThings.length} open thing{openThings.length === 1 ? '' : 's'}
          </Tag>
        ) : null}
        <a className="lt-btn lt-btn-secondary ml-auto text-xs" href={href(`/projects/${project.id}`)}>
          Open
        </a>
      </div>
    </article>
  )
}
