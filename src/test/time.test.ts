import { describe, expect, it } from 'vitest';
import { fromLocalDate, toLocalDate, toTimestamp } from '../lib/time';

describe('time conventions', () => {
  it('stores instants as fixed-width UTC ISO strings', () => {
    expect(toTimestamp(new Date(Date.UTC(2026, 8, 28, 4, 5, 6, 7)))).toBe(
      '2026-09-28T04:05:06.007Z',
    );
  });

  it('derives the local calendar day, not the UTC one', () => {
    // 23:30 local time is always "today" locally, whatever the UTC date is.
    expect(toLocalDate(new Date(2026, 8, 28, 23, 30))).toBe('2026-09-28');
  });

  it('round-trips a local date through local midnight', () => {
    const d = fromLocalDate('2026-03-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 1, 0]);
    expect(toLocalDate(d)).toBe('2026-03-01');
  });

  it('rejects impossible or malformed dates', () => {
    expect(() => fromLocalDate('2026-02-30')).toThrow(RangeError);
    expect(() => fromLocalDate('28/09/2026')).toThrow(RangeError);
  });
});
