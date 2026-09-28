import { describe, expect, it } from 'vitest';
import {
  eventMoment,
  formatRange,
  hackathonsForToday,
  orderHackathons,
  primaryMoment,
  registrationMoment,
} from '../features/hackathons/schedule';
import type { Hackathon } from '../types/domain';

const today = '2026-09-28';

let seq = 0;
function h(partial: Partial<Hackathon> & { name: string }): Hackathon {
  seq += 1;
  return {
    id: `id-${partial.name}`,
    status: 'active',
    registrationStatus: 'not_registered',
    pptStatus: 'not_started',
    buildStatus: 'not_started',
    createdAt: `2026-09-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}
const names = (list: Hackathon[]) => list.map((x) => x.name);

describe('date labels', () => {
  it.each([
    ['2026-09-26', 'Registration closed 2 days ago'],
    ['2026-09-27', 'Registration closed 1 day ago'],
    ['2026-09-28', 'Registration due today'],
    ['2026-09-29', 'Registration due tomorrow'],
    ['2026-10-02', 'Registration due in 4 days'],
    ['2026-10-12', 'Registration due 12 Oct'],
  ])('registration deadline %s → %s', (deadline, text) => {
    expect(registrationMoment(h({ name: 'x', registrationDeadline: deadline }), today)?.text).toBe(
      text,
    );
  });

  it('says nothing about a deadline once registration is handled', () => {
    for (const registrationStatus of ['registered', 'waitlisted', 'rejected'] as const) {
      expect(
        registrationMoment(
          h({ name: 'x', registrationDeadline: today, registrationStatus }),
          today,
        ),
      ).toBeNull();
    }
  });

  it.each([
    [{ eventStart: '2026-09-28' }, 'Happening today'],
    [{ eventStart: '2026-09-27', eventEnd: '2026-09-29' }, 'Happening now'],
    [{ eventStart: '2026-09-28', eventEnd: '2026-09-29' }, 'Happening now'],
    [{ eventStart: '2026-09-29' }, 'Starts tomorrow'],
    [{ eventStart: '2026-10-03' }, 'Starts in 5 days'],
    [{ eventStart: '2026-10-05' }, 'Starts 5 Oct'],
    [{ eventStart: '2026-09-25', eventEnd: '2026-09-26' }, 'Ended 2 days ago'],
    [{ eventStart: '2026-09-01' }, 'Ended 1 Sep'],
  ])('event %j → %s', (dates, text) => {
    expect(eventMoment(h({ name: 'x', ...dates }), today)?.text).toBe(text);
  });

  it.each([
    ['2026-09-28', undefined, '28 Sep'],
    ['2026-09-28', '2026-09-28', '28 Sep'],
    ['2026-09-28', '2026-09-29', '28–29 Sep'],
    ['2026-09-30', '2026-10-02', '30 Sep – 2 Oct'],
    ['2027-01-09', '2027-01-10', '9–10 Jan 2027'],
    ['2026-12-31', '2027-01-02', '31 Dec 2026 – 2 Jan 2027'],
  ])('formatRange %s..%s → %s', (start, end, text) => {
    expect(formatRange(start, end, today)).toBe(text);
  });
});

describe('orderHackathons', () => {
  it('orders by the next meaningful date, then undated, then past', () => {
    const list = [
      h({ name: 'undated' }),
      h({ name: 'event in 10 days', eventStart: '2026-10-08' }),
      h({
        name: 'registration due in 2 days, event in 20',
        registrationDeadline: '2026-09-30',
        eventStart: '2026-10-18',
      }),
      h({ name: 'past event still active', eventStart: '2026-09-10' }),
      h({ name: 'happening now', eventStart: '2026-09-27', eventEnd: '2026-09-29' }),
      h({ name: 'event in 5 days', eventStart: '2026-10-03' }),
      h({ name: 'older past', eventStart: '2026-08-01' }),
    ];
    expect(names(orderHackathons(list, today))).toEqual([
      'happening now',
      'registration due in 2 days, event in 20',
      'event in 5 days',
      'event in 10 days',
      'undated',
      'past event still active',
      'older past',
    ]);
  });

  it('ignores a registration deadline once registered', () => {
    const list = [
      h({
        name: 'registered',
        registrationStatus: 'registered',
        registrationDeadline: '2026-09-29',
        eventStart: '2026-10-20',
      }),
      h({ name: 'event sooner', eventStart: '2026-10-10' }),
    ];
    expect(names(orderHackathons(list, today))).toEqual(['event sooner', 'registered']);
  });

  it('breaks ties deterministically and is independent of input order', () => {
    const a = h({ name: 'Beta', eventStart: '2026-10-03', createdAt: '2026-09-01T00:00:00.000Z' });
    const b = h({ name: 'Alpha', eventStart: '2026-10-03', createdAt: '2026-09-01T00:00:00.000Z' });
    const c = h({ name: 'Gamma', eventStart: '2026-10-03', createdAt: '2026-08-01T00:00:00.000Z' });
    expect(names(orderHackathons([a, b, c], today))).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(names(orderHackathons([c, b, a], today))).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('picks the primary line from whatever keys the order', () => {
    expect(
      primaryMoment(
        h({ name: 'x', registrationDeadline: '2026-09-30', eventStart: '2026-10-18' }),
        today,
      )?.text,
    ).toBe('Registration due in 2 days');
    expect(
      primaryMoment(
        h({ name: 'x', registrationDeadline: '2026-09-20', eventStart: '2026-10-01' }),
        today,
      )?.text,
    ).toBe('Starts in 3 days');
    expect(primaryMoment(h({ name: 'x', eventStart: '2026-09-10' }), today)?.text).toBe(
      'Ended 10 Sep',
    );
    expect(primaryMoment(h({ name: 'x' }), today)).toBeNull();
  });
});

describe('hackathonsForToday', () => {
  const rows = (list: Hackathon[]) =>
    hackathonsForToday(list, today).rows.map((r) => [r.hackathon.name, r.label]);

  it('includes registration due today and overdue unresolved registration', () => {
    expect(
      rows([
        h({ name: 'due today', registrationDeadline: today }),
        h({ name: 'overdue', registrationDeadline: '2026-09-20' }),
      ]),
    ).toEqual([
      ['overdue', 'Registration closed 8 days ago'],
      ['due today', 'Registration due today'],
    ]);
  });

  it('ignores a resolved registration deadline as a reason', () => {
    expect(
      rows([
        h({ name: 'registered', registrationDeadline: today, registrationStatus: 'registered' }),
      ]),
    ).toEqual([]);
    expect(
      rows([
        h({ name: 'waitlisted', registrationDeadline: today, registrationStatus: 'waitlisted' }),
      ]),
    ).toEqual([]);
  });

  it('includes events happening today, now, or starting within 7 days; hides 8+ days', () => {
    expect(
      rows([
        h({ name: 'today', eventStart: today }),
        h({ name: 'in 7 days', eventStart: '2026-10-05' }),
        h({ name: 'in 8 days', eventStart: '2026-10-06' }),
        h({ name: 'ongoing', eventStart: '2026-09-26', eventEnd: '2026-09-29' }),
        h({ name: 'ended', eventStart: '2026-09-20', eventEnd: '2026-09-27' }),
      ]),
    ).toEqual([
      ['ongoing', 'Happening now'],
      ['today', 'Happening today'],
      ['in 7 days', 'Starts 5 Oct'],
    ]);
  });

  it('hides finished, dropped and rejected hackathons', () => {
    expect(
      rows([
        h({ name: 'finished', status: 'finished', eventStart: today }),
        h({ name: 'dropped', status: 'dropped', registrationDeadline: today }),
        h({ name: 'rejected', registrationStatus: 'rejected', eventStart: today }),
      ]),
    ).toEqual([]);
  });

  it('shows a hackathon with two reasons once, with both facts', () => {
    expect(
      rows([h({ name: 'both', registrationDeadline: '2026-09-29', eventStart: '2026-10-02' })]),
    ).toEqual([['both', 'Registration due tomorrow · Starts in 4 days']]);
  });

  it('shows at most 3 and counts the rest', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((n, i) =>
      h({ name: n, eventStart: `2026-09-${29 + (i % 2)}` }),
    );
    const result = hackathonsForToday(list, today);
    expect(result.rows).toHaveLength(3);
    expect(result.more).toBe(2);
    expect(hackathonsForToday(list.slice(0, 3), today).more).toBe(0);
  });
});
