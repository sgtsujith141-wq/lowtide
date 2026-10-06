import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotConnected } from '../app/NotConnected';
import {
  BACKEND_KEY,
  claimPairing,
  pairCodeFromHash,
  servedByCompanion,
  type PairingEnv,
} from '../db/companion/backend';

const CODE = 'a'.repeat(43);
const TOKEN = 't'.repeat(43);

function env(hash: string, reply: () => Promise<Response>) {
  const stored = new Map<string, string>();
  const replaced: string[] = [];
  const calls: [string, RequestInit | undefined][] = [];
  const e: PairingEnv = {
    location: { hash, pathname: '/projects', search: '?x=1', origin: 'http://127.0.0.1:4318' },
    history: {
      replaceState: (_s: unknown, _t: string, url?: string | URL | null) =>
        void replaced.push(String(url)),
    },
    fetch: (input, init) => {
      calls.push([input, init]);
      // The code is out of the address bar before the request goes out.
      expect(replaced).toEqual(['/projects?x=1']);
      return reply();
    },
    storage: {
      setItem: (k, v) => void stored.set(k, v),
      removeItem: (k) => void stored.delete(k),
    },
  };
  return { e, stored, replaced, calls };
}

describe('pairing from the LOWTIDE app (ADR-075)', () => {
  it('exchanges the code once, forgets it from the address and remembers the companion', async () => {
    const { e, stored, calls } = env(`#pair=${CODE}`, async () =>
      Response.json({ url: 'http://127.0.0.1:4318', token: TOKEN }),
    );
    expect(await claimPairing(e)).toBe('paired');
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('http://127.0.0.1:4318/api/pair');
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ code: CODE });
    expect(JSON.parse(stored.get(BACKEND_KEY)!)).toEqual({
      kind: 'companion',
      url: 'http://127.0.0.1:4318',
      token: TOKEN,
    });
  });

  it('does nothing without a code, and saves nothing when the code is refused', async () => {
    const none = env('#other=1', async () => Response.json({}));
    expect(await claimPairing(none.e)).toBe('none');
    expect(none.calls).toHaveLength(0);
    const refused = env(`#pair=${CODE}`, async () => new Response('{}', { status: 401 }));
    expect(await claimPairing(refused.e)).toBe('failed');
    expect(refused.stored.size).toBe(0);
    const down = env(`#pair=${CODE}`, () => Promise.reject(new Error('offline')));
    expect(await claimPairing(down.e)).toBe('failed');
  });

  it('reads only well-formed codes and knows when the companion served the page', () => {
    expect(pairCodeFromHash(`#pair=${CODE}`)).toBe(CODE);
    expect(pairCodeFromHash('#pair=../../x')).toBeUndefined();
    const doc = { querySelector: vi.fn(() => ({}) as Element) };
    expect(servedByCompanion(doc)).toBe(true);
    expect(servedByCompanion({ querySelector: () => null })).toBe(false);
  });

  it('asks to open LOWTIDE from the app instead of showing an empty browser LOWTIDE', () => {
    render(<NotConnected failed />);
    expect(
      screen.getByRole('heading', { name: 'Open LOWTIDE from the LOWTIDE app' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/had expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
