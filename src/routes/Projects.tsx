import { useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { latestCapsule, thingsForProject } from '../lib/model.ts'
import { relativeDay } from '../lib/dates.ts'
import { useNow } from '../lib/clock.ts'
import { href, navigate } from '../lib/router.ts'
import { Empty, Field, PageHead, Panel, Quiet, SectionHead, Tag } from '../components/ui.tsx'
import type { Project } from '../lib/types.ts'

export function Projects() {
  const store = useStore()
  const toast = useToast()
  const now = useNow()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const open = store.projects
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
      const project = await store.createProject(name, description)
      setName('')
      setDescription('')
      navigate(`/projects/${project.id}`)
    } catch {
      toast.show('That project could not be saved — what you typed is still here.', {
        tone: 'problem',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHead
        eyebrow="Projects"
        title="The black box."
        lede="One box per project, holding what you would otherwise have to rebuild from memory: where it stands, what stopped you, and the exact next move."
      />

      <form onSubmit={create} className="paper mb-6 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Start a project" htmlFor="project-name">
          <input
            id="project-name"
            className="field"
            placeholder="Harrow deck, kitchen rewire, Q3 hiring…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="What is it, in a line" htmlFor="project-description">
          <input
            id="project-description"
            className="field"
            placeholder="Optional"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-solid h-[34px]" disabled={!name.trim() || busy}>
          Create
        </button>
      </form>

      {open.length === 0 ? (
        <Empty>No projects yet. A project earns a box when it needs a memory.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {open.map((project) => (
            <ProjectCard key={project.id} project={project} now={now} />
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <section className="mt-8">
          <SectionHead count={archived.length}>Archived</SectionHead>
          <Panel className="!py-1">
            {archived.map((project) => (
              <div
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft py-2.5 last:border-b-0"
              >
                <a className="link display text-[1.05rem]" href={href(`/projects/${project.id}`)}>
                  {project.name}
                </a>
                <Quiet>
                  {project.archivedAt ? `archived ${relativeDay(project.archivedAt, now)}` : 'archived'}
                </Quiet>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}
    </div>
  )
}

function ProjectCard({ project, now }: { project: Project; now: number }) {
  const store = useStore()
  const capsule = latestCapsule(store.capsules, project.id)
  const openThings = thingsForProject(store.things, project.id).filter((t) => t.status === 'open')

  return (
    <article className="paper flex flex-col p-4 transition-shadow hover:shadow-[var(--shadow-lift)]">
      <h2 className="display text-[1.15rem]">
        <a className="hover:text-forest-deep" href={href(`/projects/${project.id}`)}>
          {project.name}
        </a>
      </h2>
      {project.description ? (
        <p className="mt-1 text-[0.8125rem] leading-snug text-muted">{project.description}</p>
      ) : null}

      {capsule ? (
        <>
          {capsule.nextAction ? (
            <div className="paper-2 mt-3 px-3 py-2">
              <p className="eyebrow mb-0.5">Next</p>
              <p className="written text-[0.9375rem]">{capsule.nextAction}</p>
            </div>
          ) : capsule.status ? (
            <Quiet className="mt-2">{capsule.status}</Quiet>
          ) : null}
          <p className="mt-2.5 text-[0.7rem] text-muted">
            place saved {relativeDay(capsule.savedAt, now)}
          </p>
        </>
      ) : (
        <Quiet className="mt-2">
          No place saved yet. Open it and write down where you are before you stop.
        </Quiet>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {capsule?.blocker ? <Tag tone="sand">blocked</Tag> : null}
        {openThings.length > 0 ? <Tag>{openThings.length} open</Tag> : null}
        <a className="btn btn-soft ml-auto" href={href(`/projects/${project.id}`)}>
          Open
        </a>
      </div>
    </article>
  )
}
