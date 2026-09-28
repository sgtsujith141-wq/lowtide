import { describe, expect, it } from 'vitest';
import { describeDeadline } from '../features/tasks/deadline';
import { draftFromTask, draftToChanges, draftToNewTask, emptyDraft } from '../features/tasks/draft';
import { orderOpenTasks } from '../features/tasks/order';
import { formatWhen } from '../lib/when';
import type { Task } from '../types/domain';

const due = (day: string) => `${day}T12:00:00.000Z`;

describe('describeDeadline', () => {
  const today = '2026-09-28'; // a Monday
  it.each([
    [due('2026-09-20'), 'overdue', 'Was due 20 Sep'],
    [due('2026-09-27'), 'overdue', 'Was due yesterday'],
    [due('2026-09-28'), 'today', 'Due today'],
    [due('2026-09-29'), 'soon', 'Due tomorrow'],
    [due('2026-10-02'), 'soon', 'Due Friday'],
    [due('2026-10-12'), 'later', 'Due 12 Oct'],
    [due('2027-01-05'), 'later', 'Due 5 Jan 2027'],
  ])('%s → %s "%s"', (dueAt, tone, text) => {
    expect(describeDeadline(dueAt, today)).toEqual({ tone, text });
  });
});

function task(partial: Partial<Task> & { title: string }): Task {
  return {
    id: partial.title,
    status: 'todo',
    priority: 'normal',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

describe('orderOpenTasks', () => {
  it('puts deadlines first (soonest first), then priority, then age', () => {
    const ordered = orderOpenTasks([
      task({ title: 'old normal', createdAt: '2026-09-01T00:00:00.000Z' }),
      task({ title: 'new high', priority: 'high', createdAt: '2026-09-05T00:00:00.000Z' }),
      task({ title: 'due later', dueAt: due('2026-10-10') }),
      task({ title: 'due soon low', dueAt: due('2026-09-30'), priority: 'low' }),
      task({ title: 'low', priority: 'low' }),
      task({ title: 'newer normal', createdAt: '2026-09-03T00:00:00.000Z' }),
    ]);
    expect(ordered.map((t) => t.title)).toEqual([
      'due soon low',
      'due later',
      'new high',
      'old normal',
      'newer normal',
      'low',
    ]);
  });
});

describe('task drafts', () => {
  it('builds a NewTask with only the filled-in fields', () => {
    expect(draftToNewTask({ ...emptyDraft, title: 'x' })).toEqual({
      title: 'x',
      priority: 'normal',
    });
    expect(
      draftToNewTask({ title: 'x', notes: 'n', priority: 'low', due: '2026-10-01', project: 'P' }),
    ).toEqual({ title: 'x', notes: 'n', priority: 'low', dueAt: due('2026-10-01'), project: 'P' });
  });

  it('round-trips a task through a draft and sends clears explicitly', () => {
    const t = task({ title: 't', notes: 'n', project: 'p', dueAt: due('2026-10-01') });
    const draft = draftFromTask(t);
    expect(draft).toEqual({
      title: 't',
      notes: 'n',
      priority: 'normal',
      due: '2026-10-01',
      project: 'p',
    });
    expect(draftToChanges({ ...draft, due: '', notes: '', project: '' })).toEqual({
      title: 't',
      priority: 'normal',
      notes: '',
      project: '',
      dueAt: null,
    });
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 8, 28, 15, 0);
  const at = (d: Date) => d.toISOString();
  it.each([
    [new Date(2026, 8, 28, 14, 59, 30), 'just now'],
    [new Date(2026, 8, 28, 9, 5), '09:05'],
    [new Date(2026, 8, 27, 23, 0), 'yesterday'],
    [new Date(2026, 8, 24, 10, 0), 'Thu'],
    [new Date(2026, 7, 2, 10, 0), '2 Aug'],
    [new Date(2025, 11, 31, 10, 0), '31 Dec 2025'],
  ])('%s → %s', (date, text) => {
    expect(formatWhen(at(date), now)).toBe(text);
  });
});
