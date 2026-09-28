import { describe, expect, it } from 'vitest';
import { describePlan } from '../features/tasks/planning';
import { composeToday, needsAttention, planCandidates } from '../features/today/compose';
import type { Task } from '../types/domain';

const today = '2026-09-28';
const due = (day: string) => `${day}T12:00:00.000Z`;

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

const titles = (list: Task[]) => list.map((t) => t.title);

describe('composeToday', () => {
  const all = [
    task({ title: 'overdue', dueAt: due('2026-09-25') }),
    task({ title: 'due today', dueAt: due(today) }),
    task({ title: 'due tomorrow', dueAt: due('2026-09-29') }),
    task({ title: 'planned today', plannedFor: today }),
    task({ title: 'planned tomorrow', plannedFor: '2026-09-29' }),
    task({ title: 'planned yesterday', plannedFor: '2026-09-27' }),
    task({ title: 'due and planned today', dueAt: due(today), plannedFor: today }),
    task({ title: 'planned today, due later', plannedFor: today, dueAt: due('2026-10-03') }),
    task({ title: 'done, due today', dueAt: due(today), status: 'done' }),
    task({ title: 'dropped, planned today', plannedFor: today, status: 'dropped' }),
    task({ title: 'plain' }),
  ];
  const sections = composeToday(all, today);

  it('puts overdue and due-today open tasks under Needs attention', () => {
    expect(titles(sections.attention)).toEqual(['overdue', 'due today', 'due and planned today']);
  });

  it('puts planned-today open tasks under My plan, minus anything already under attention', () => {
    expect(titles(sections.planned)).toEqual(['planned today, due later', 'planned today']);
  });

  it('shows every task at most once', () => {
    const shown = [...titles(sections.attention), ...titles(sections.planned)];
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('leaves out future deadlines, other days’ plans, closed and unrelated tasks', () => {
    const shown = [...titles(sections.attention), ...titles(sections.planned)];
    for (const hidden of [
      'due tomorrow',
      'planned tomorrow',
      'planned yesterday',
      'done, due today',
      'dropped, planned today',
      'plain',
    ]) {
      expect(shown).not.toContain(hidden);
    }
  });

  it('orders deterministically: deadline, then priority, then age, regardless of input order', () => {
    const input = [
      task({ title: 'b normal', plannedFor: today, createdAt: '2026-09-02T00:00:00.000Z' }),
      task({ title: 'a high', plannedFor: today, priority: 'high' }),
      task({ title: 'c low', plannedFor: today, priority: 'low' }),
      task({ title: 'a normal older', plannedFor: today, createdAt: '2026-09-01T00:00:00.000Z' }),
    ];
    const expected = ['a high', 'a normal older', 'b normal', 'c low'];
    expect(titles(composeToday(input, today).planned)).toEqual(expected);
    expect(titles(composeToday([...input].reverse(), today).planned)).toEqual(expected);
  });

  it('keeps a due-today task under attention even with no plan', () => {
    expect(needsAttention(task({ title: 'x', dueAt: due(today) }), today)).toBe(true);
    expect(needsAttention(task({ title: 'x', plannedFor: today }), today)).toBe(false);
  });
});

describe('planCandidates', () => {
  it('offers open tasks not already on Today', () => {
    const open = [
      task({ title: 'future deadline', dueAt: due('2026-10-10') }),
      task({ title: 'already planned', plannedFor: today }),
      task({ title: 'overdue', dueAt: due('2026-09-01') }),
      task({ title: 'planned tomorrow', plannedFor: '2026-09-29' }),
      task({ title: 'free' }),
    ];
    expect(titles(planCandidates(open, today))).toEqual([
      'future deadline',
      'planned tomorrow',
      'free',
    ]);
  });
});

describe('describePlan', () => {
  it.each([
    [undefined, null],
    ['2026-09-27', null],
    [today, 'In today’s plan'],
    ['2026-09-29', 'Planned for tomorrow'],
    ['2026-10-01', 'Planned for Thursday'],
    ['2026-10-20', 'Planned for 20 Oct'],
  ])('%s → %s', (plannedFor, text) => {
    expect(describePlan(plannedFor, today)).toBe(text);
  });
});
