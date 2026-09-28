import { afterEach, describe, expect, it } from 'vitest';
import {
  deadlineFromLocalDate,
  fromLocalDate,
  localDateOfDeadline,
  toLocalDate,
  toTimestamp,
} from '../lib/time';

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

// jsdom tests have no Node typings; TZ is read by Node at call time.
declare const process: { env: Record<string, string | undefined> };

describe('date-only deadlines', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    // Assigning undefined would set the string "undefined".
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('stores a chosen day as UTC noon of that date and reads the same day back', () => {
    const dueAt = deadlineFromLocalDate('2026-10-05');
    expect(dueAt).toBe('2026-10-05T12:00:00.000Z');
    expect(localDateOfDeadline(dueAt)).toBe('2026-10-05');
    expect(() => deadlineFromLocalDate('2026-02-30')).toThrow(RangeError);
  });

  // Offsets up to 17h apart: a local-noon encoding fails several of these.
  it.each([
    ['Asia/Kolkata', 'America/Los_Angeles'],
    ['America/Los_Angeles', 'Asia/Kolkata'],
    ['Europe/London', 'Pacific/Auckland'],
    ['Pacific/Auckland', 'America/New_York'],
  ])('keeps the day when entered in %s and shown in %s', (from, to) => {
    process.env.TZ = from;
    const dueAt = deadlineFromLocalDate('2026-03-29');
    process.env.TZ = to;
    expect(localDateOfDeadline(dueAt)).toBe('2026-03-29');
  });

  it('keeps the day across a DST change', () => {
    process.env.TZ = 'Europe/London'; // clocks go forward on 2026-03-29
    for (const day of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-25']) {
      expect(localDateOfDeadline(deadlineFromLocalDate(day))).toBe(day);
    }
  });
});
