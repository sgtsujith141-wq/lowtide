import { describe, expect, it } from 'vitest';
import { habitSchema, protectedTimeSchema, taskSchema } from '../db/schema';

const validTask = {
  id: '6f1c2f0e-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
  title: 'Water the plants',
  status: 'todo',
  priority: 'normal',
  createdAt: '2026-09-28T09:00:00.000Z',
  updatedAt: '2026-09-28T09:00:00.000Z',
};

describe('persisted-record schemas', () => {
  it('accepts a well-formed record', () => {
    expect(taskSchema.parse(validTask)).toEqual(validTask);
  });

  it('rejects optional fields stored as undefined or null', () => {
    expect(() => taskSchema.parse({ ...validTask, notes: undefined })).toThrow();
    expect(() => taskSchema.parse({ ...validTask, notes: null })).toThrow();
  });

  it('rejects unknown enum values, bad ids and non-UTC timestamps', () => {
    expect(() => taskSchema.parse({ ...validTask, status: 'someday' })).toThrow();
    expect(() => taskSchema.parse({ ...validTask, id: '42' })).toThrow();
    expect(() => taskSchema.parse({ ...validTask, dueAt: '2026-09-28' })).toThrow();
    expect(() => taskSchema.parse({ ...validTask, dueAt: '2026-09-28T09:00:00+05:30' })).toThrow();
  });

  it('requires a positive habit target when present', () => {
    const habit = {
      id: validTask.id,
      name: 'Walk',
      category: 'fitness',
      unit: 'minutes',
      archived: false,
      createdAt: validTask.createdAt,
    };
    expect(habitSchema.parse({ ...habit, target: 20 }).target).toBe(20);
    expect(() => habitSchema.parse({ ...habit, target: 0 })).toThrow();
  });

  it('does not allow relationships to be tracked as a habit', () => {
    const habit = {
      id: validTask.id,
      name: 'Date night',
      category: 'relationships',
      unit: 'check',
      archived: false,
      createdAt: validTask.createdAt,
    };
    expect(() => habitSchema.parse(habit)).toThrow();
  });

  it('keeps relationship, family and friends time as protected time', () => {
    for (const kind of ['relationship', 'family', 'friends']) {
      expect(
        protectedTimeSchema.parse({ id: validTask.id, title: 'Dinner', date: '2026-09-28', kind })
          .kind,
      ).toBe(kind);
    }
  });
});
