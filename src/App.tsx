import { Shell } from './components/Shell.tsx'
import { href, match, usePath } from './lib/router.ts'
import { useStore } from './lib/store-context.ts'
import { Landing } from './routes/Landing.tsx'
import { Dump } from './routes/Dump.tsx'
import { Things } from './routes/Things.tsx'
import { Projects } from './routes/Projects.tsx'
import { ProjectDetail } from './routes/ProjectDetail.tsx'
import { ReturnView } from './routes/ReturnView.tsx'
import { Closure } from './routes/Closure.tsx'
import { Closed } from './routes/Closed.tsx'
import { DataVault } from './routes/DataVault.tsx'

export default function App() {
  const path = usePath()
  const store = useStore()

  if (!store.ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6">
        <p className="lt-fade lt-display text-sm tracking-[0.34em] text-muted">LOWTIDE</p>
      </div>
    )
  }

  if (store.loadError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6">
        <div className="lt-card max-w-lg p-6" role="alert">
          <h1 className="lt-display mb-3 text-2xl">LOWTIDE cannot reach its storage</h1>
          <p className="mb-2 text-sm leading-relaxed text-muted">{store.loadError}</p>
          <p className="mb-5 text-sm leading-relaxed text-muted">
            Nothing that was saved before has been lost — this browser simply will not open the
            local database right now. Anything you write while this message is showing cannot be
            kept.
          </p>
          <button type="button" className="lt-btn lt-btn-primary" onClick={() => void store.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  // The closing screen is deliberately outside the shell: no nav, no counts.
  if (path === '/closed') return <Closed />

  return <Shell>{renderRoute(path)}</Shell>
}

function renderRoute(path: string) {
  if (path === '/') return <Landing />
  if (path === '/dump') return <Dump />
  if (path === '/things') return <Things />
  if (path === '/projects') return <Projects />
  if (path === '/return') return <ReturnView />
  if (path === '/close') return <Closure />
  if (path === '/data') return <DataVault />

  const project = match('/projects/:id', path)
  if (project) return <ProjectDetail projectId={project.id} />

  return (
    <div className="py-16 text-center">
      <h1 className="lt-display mb-3 text-3xl">Nothing lives here</h1>
      <p className="mb-6 text-sm text-muted">That address doesn’t match a page in LOWTIDE.</p>
      <a className="lt-btn lt-btn-secondary" href={href('/')}>
        Back to the start
      </a>
    </div>
  )
}
