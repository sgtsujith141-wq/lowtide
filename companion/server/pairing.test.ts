// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { PAIR_CODE_TTL_MS, PairCodes } from './pairing';
import { startTestCompanion, type TestCompanion } from './test-fixtures';

/*
 * v2.3 (ADR-075): the LOWTIDE app launcher opens LOWTIDE with a one-time
 * code; the page the companion served exchanges it once for the owner token.
 */

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

describe('one-time pairing codes (ADR-075)', () => {
  it('works once, only from the companion’s own page, and only for the owner who asked', async () => {
    const t = await startTestCompanion();
    running.push(t);
    // Minting a code needs the owner token.
    expect((await fetch(`${t.companion.url}/api/pair-codes`, { method: 'POST' })).status).toBe(401);
    const minted = (await (await t.owner('/api/pair-codes', { method: 'POST' })).json()) as {
      code: string;
      expiresInSeconds: number;
    };
    expect(minted.expiresInSeconds).toBe(60);
    const claim = (code: string, origin?: string) =>
      fetch(`${t.companion.url}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ code }),
      });
    expect((await claim(minted.code)).status).toBe(403); // no origin: not the app's page
    expect((await claim(minted.code, 'http://localhost:5173')).status).toBe(403);
    const ok = await claim(minted.code, t.companion.url);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      url: t.companion.url,
      token: t.ownerToken,
    });
    expect((await claim(minted.code, t.companion.url)).status).toBe(401); // used up
    expect((await claim('x'.repeat(43), t.companion.url)).status).toBe(401); // never minted
  });

  it('expires a code after a minute and keeps only a few open', () => {
    let now = 0;
    const codes = new PairCodes(() => now);
    const first = codes.create().code;
    now += PAIR_CODE_TTL_MS + 1;
    expect(codes.claim(first)).toBe(false);
    const fresh = codes.create().code;
    for (let i = 0; i < 25; i++) codes.create();
    expect(codes.claim(fresh)).toBe(false); // pushed out by newer codes
    expect(codes.claim(undefined)).toBe(false);
    expect(codes.claim('short')).toBe(false);
  });
});
