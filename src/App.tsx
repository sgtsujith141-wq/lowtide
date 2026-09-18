import { Shell } from './components/Shell.tsx'
import { href, match, navigate, usePath } from './lib/router.ts'
import { useStore } from './lib/store-context.ts'
import { Home } from './routes/Home.tsx'
import { Things } from './routes/Things.tsx'
import { Projects } from './routes/Projects.tsx'
import { ProjectDetail } from './routes/ProjectDetail.tsx'
import { ReturnView } from './routes/ReturnView.tsx'
import { Ritual } from './routes/Ritual.tsx'
import { Closed } from './routes/Closed.tsx'
import { DataVault } from './routes/DataVault.tsx'

export default function App() {
  const path = usePath()
  const store = useStore()

  if (!store.ready) {
    return (
      <div className="relative z-1 flex min-h-[100dvh] items-center justify-center px-6">
        <p className="fade display text-[0.8rem] tracking-[0.3em] text-muted">LOWTIDE</p>
      </div>
    )
  }

  if (store.loadError) {
    return (
      <div className="relative z-1 flex min-h-[100dvh] items-center justify-center px-6">
        <div className="paper max-w-md p-5" role="alert">
          <h1 className="display mb-2 text-xl">LOWTIDE cannot reach its storage</h1>
          <p className="mb-2 text-[0.8125rem] leading-relaxed text-muted">{store.loadError}</p>
          <p className="mb-4 text-[0.8125rem] leading-relaxed text-muted">
            Nothing saved before has been lost — this browser will not open the local database right
            now. Anything written while this message shows cannot be kept.
          </p>
          <button type="button" className="btn btn-solid" onClick={() => void store.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  // The closing state stands outside the workspace frame.
  if (path === '/closed') return <Closed />

  return <Shell>{renderRoute(path)}</Shell>
}

function renderRoute(path: string) {
  if (path === '/') return <Home />
  if (path === '/things') return <Things />
  if (path === '/projects') return <Projects />
  if (path === '/return') return <ReturnView />
  if (path === '/ritual') return <Ritual />
  if (path === '/data') return <DataVault />

  // Paths from the first milestone still work rather than 404-ing.
  if (path === '/dump') {
    navigate('/')
    return <Home />
  }
  if (path === '/close') {
    navigate('/ritual')
    return <Ritual />
  }

  const project = match('/projects/:id', path)
  if (project) return <ProjectDetail projectId={project.id} />

  return (
    <div className="py-14 text-center">
      <h1 className="display mb-2 text-2xl">Nothing lives here</h1>
      <p className="mb-5 text-[0.8125rem] text-muted">That address is not a page in LOWTIDE.</p>
      <a className="btn btn-soft" href={href('/')}>
        Back to the notebook
      </a>
    </div>
  )
}
