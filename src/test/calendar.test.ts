import { afterEach, describe, expect, it } from 'vitest';
import { addDays, daysBetween, eachDay, startOfWeek, weekdayIndex } from '../lib/calendar';

declare const process: { env: Record<string, string | undefined> };

describe('LocalDate calendar arithmetic', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('knows weekdays, Monday first', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-04')).toBe(6); // Sunday
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('rejects impossible dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });

  describe('in DST zones', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    it.each(['Europe/London', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata'])(
      'never skips or repeats a day across a whole year in %s',
      (zone) => {
        process.env.TZ = zone;
        const days = eachDay('2026-01-01', '2026-12-31');
        expect(days).toHaveLength(365);
        expect(new Set(days).size).toBe(365);
        for (let i = 1; i < days.length; i++) {
          expect(daysBetween(days[i - 1]!, days[i]!)).toBe(1);
        }
        expect(days).toContain('2026-03-29'); // EU clocks go forward
        expect(days).toContain('2026-11-01'); // US clocks go back
      },
    );
  });
});
