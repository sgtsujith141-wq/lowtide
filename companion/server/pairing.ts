import { createHash, randomBytes } from 'node:crypto';

/*
 * One-time pairing codes (v2.3, ADR-075). The LOWTIDE app launcher (which
 * can read the owner token on this computer) asks the companion for a code
 * and opens the app with it in the address fragment; the page the companion
 * served exchanges it, once, for the owner token and forgets it from the
 * address. A code lasts a minute, works once, and is kept only as a hash, so
 * nothing long-lived ever appears in a URL, a history entry or a log.
 */

export const PAIR_CODE_TTL_MS = 60_000;
const MAX_OPEN_CODES = 20;

const digest = (code: string) => createHash('sha256').update(code).digest('hex');

export class PairCodes {
  private readonly open = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  private prune() {
    const at = this.now();
    for (const [hash, expires] of this.open) if (expires <= at) this.open.delete(hash);
  }

  /** A fresh code, valid for a minute. */
  create(): { code: string; expiresInSeconds: number } {
    this.prune();
    while (this.open.size >= MAX_OPEN_CODES) {
      this.open.delete(this.open.keys().next().value as string);
    }
    const code = randomBytes(32).toString('base64url');
    this.open.set(digest(code), this.now() + PAIR_CODE_TTL_MS);
    return { code, expiresInSeconds: PAIR_CODE_TTL_MS / 1000 };
  }

  /** True once for a valid, unexpired code; the code is gone afterwards either way. */
  claim(code: unknown): boolean {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(code)) return false;
    this.prune();
    const hash = digest(code);
    const expires = this.open.get(hash);
    this.open.delete(hash);
    return expires !== undefined && expires > this.now();
  }
}
