import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildCalendar,
  monthBlock,
  shiftMonth,
  type CalendarSources,
} from '../features/calendar/entries';
import { createDexieRepositories } from '../db/repositories';
import { addDays } from '../lib/calendar';
import { format } from 'date-fns';
import { deadlineFromLocalDate, fromLocalDate, toLocalDate } from '../lib/time';
import type { Hackathon, Task } from '../types/domain';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const T = '2026-09-01T08:00:00.000Z';
const empty: CalendarSources = {
  college: [],
  hackathons: [],
  milestones: [],
  projects: [],
  tasks: [],
  protectedTime: [],
  offTime: [],
  work: [],
};

describe('calendar entries (pure)', () => {
  it('lays out a Monday-first six-week block and moves by month', () => {
    expect(monthBlock('2026-09-30')).toEqual({
      start: '2026-08-31',
      end: '2026-10-11',
      month: '2026-09',
    });
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('places every kind of record on its date, in a stable order', () => {
    const hackathon: Hackathon = {
      id: 'h1',
      name: 'Autumn hack',
      registrationDeadline: '2026-10-01',
      eventStart: '2026-10-03',
      eventEnd: '2026-10-04',
      registrationStatus: 'not_registered',
      pptStatus: 'not_started',
      buildStatus: 'not_started',
      status: 'active',
      createdAt: T,
      updatedAt: T,
    };
    const task = (over: Partial<Task>): Task => ({
      id: crypto.randomUUID(),
      title: 't',
      status: 'todo',
      priority: 'normal',
      createdAt: T,
      updatedAt: T,
      ...over,
    });
    const days = buildCalendar(
      {
        ...empty,
        hackathons: [hackathon],
        tasks: [
          task({
            title: 'Essay',
            dueAt: deadlineFromLocalDate('2026-10-01'),
            plannedFor: '2026-09-30',
          }),
          task({
            title: 'Done already',
            status: 'done',
            dueAt: deadlineFromLocalDate('2026-10-01'),
          }),
        ],
        protectedTime: [{ id: 'p1', title: 'Dinner', date: '2026-10-01', kind: 'relationship' }],
        college: [
          {
            id: 'c1',
            kind: 'class',
            title: 'DBMS',
            date: '2026-10-01',
            status: 'attended',
            createdAt: T,
            updatedAt: T,
          },
        ],
        offTime: [
          { id: 'o1', kind: 'day_off', localDate: '2026-10-04', createdAt: T, updatedAt: T },
        ],
      },
      '2026-09-28',
      '2026-10-11',
    );
    expect(days.get('2026-10-01')!.map((e) => [e.kind, e.title])).toEqual([
      ['protected', 'Dinner'],
      ['college', 'DBMS'],
      ['hackathon', 'Autumn hack: registration due'],
      ['deadline', 'Essay'],
    ]);
    expect(days.get('2026-09-30')!.map((e) => e.kind)).toEqual(['planned']);
    expect(days.get('2026-10-03')![0]).toMatchObject({
      title: 'Autumn hack',
      detail: 'day 1 of 2',
    });
    expect(days.get('2026-10-04')!.map((e) => e.kind)).toEqual(['dayoff', 'hackathon']);
  });
});

describe('Calendar page', () => {
  it('shows the month and the selected day’s agenda from real records', async () => {
    const today = toLocalDate(new Date());
    const r = createDexieRepositories(newDb());
    await r.college.create({ kind: 'lab', title: 'Networks lab', date: today });
    await r.tasks.create({ title: 'Submit form', dueAt: deadlineFromLocalDate(today) });
    await r.protectedTime.create({ title: 'Call home', date: today, kind: 'family' });
    const { user } = await renderApp('/calendar', r);
    const agenda = screen.getByRole('region', { name: /today/ });
    expect(await within(agenda).findByText('Networks lab')).toBeInTheDocument();
    expect(await within(agenda).findByText('Submit form')).toBeInTheDocument();
    expect(await within(agenda).findByText('Call home')).toBeInTheDocument();

    const todayButton = screen.getByRole('button', { current: 'date' });
    expect(todayButton).toHaveAccessibleName(/3 items$/);

    const tomorrow = addDays(today, 1);
    if (tomorrow.slice(0, 7) === today.slice(0, 7)) {
      // The six-week grid can show the same day number twice (this month and the
      // next), so the name includes the month.
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(`^${format(fromLocalDate(tomorrow), 'EEEE d MMMM')}\\b`),
        }),
      );
      expect(await screen.findByText('Nothing on this day.')).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(
      await within(screen.getByRole('region', { name: /today/ })).findByText('Networks lab'),
    ).toBeInTheDocument();
  });
});
