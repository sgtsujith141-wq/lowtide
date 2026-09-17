import { useCallback, useEffect, useState } from 'react'

/**
 * A ~50-line hash router.
 *
 * Hash routing is deliberate: it keeps LOWTIDE working when the built files are
 * opened directly from disk or served by any static host, with no rewrite rules
 * and no server. That matters for an offline-first app.
 */
export function currentPath(): string {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw || raw === '/') return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function navigate(to: string): void {
  const next = to.startsWith('/') ? to : `/${to}`
  if (currentPath() === next) return
  window.location.hash = next
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return path
}

export function useNavigate(): (to: string) => void {
  return useCallback((to: string) => navigate(to), [])
}

/** Matches '/projects/:id' against '/projects/p_123'. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const a = path.split('/').filter(Boolean)
  if (p.length !== a.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const segment = p[i]
    const actual = a[i]
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(actual)
    else if (segment !== actual) return null
  }
  return params
}

export function href(to: string): string {
  return `#${to.startsWith('/') ? to : `/${to}`}`
}
