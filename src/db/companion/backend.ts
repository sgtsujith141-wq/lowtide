/*
 * Where this browser's LOWTIDE keeps its data (ADR-058): the browser's own
 * IndexedDB (stage A), or the local companion (stage C). Chosen by the
 * owner in Settings and remembered per browser. There is no automatic
 * switching and no fallback between them.
 */

export type Backend = { kind: 'browser' } | { kind: 'companion'; url: string; token: string };

export const BACKEND_KEY = 'lowtide-backend';
export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:4318';

/** The companion only ever runs on this machine: loopback http with a port. */
export function companionUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'http:' || !loopback || !url.port || url.pathname !== '/') {
      return undefined;
    }
    return `${url.protocol}//${url.hostname}:${url.port}`;
  } catch {
    return undefined;
  }
}

export function readBackend(storage: Pick<Storage, 'getItem'> = localStorage): Backend {
  try {
    const raw = storage.getItem(BACKEND_KEY);
    if (!raw) return { kind: 'browser' };
    const value = JSON.parse(raw) as { kind?: string; url?: string; token?: string };
    const url = value.kind === 'companion' && value.url ? companionUrl(value.url) : undefined;
    if (url && typeof value.token === 'string' && value.token.length >= 32) {
      return { kind: 'companion', url, token: value.token };
    }
  } catch {
    // Unreadable setting: stay in the browser.
  }
  return { kind: 'browser' };
}

export function saveBackend(
  backend: Backend,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
) {
  if (backend.kind === 'browser') storage.removeItem(BACKEND_KEY);
  else storage.setItem(BACKEND_KEY, JSON.stringify(backend));
}

/** Reads a pairing link's fragment: #companion=<url>&token=<token>. */
export function pairingFromHash(hash: string): { url: string; token: string } | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const url = companionUrl(params.get('companion') ?? '');
  const token = params.get('token') ?? '';
  return url && /^[A-Za-z0-9_-]{32,200}$/.test(token) ? { url, token } : undefined;
}
