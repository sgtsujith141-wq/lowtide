import * as z from 'zod/mini';
import { toLocalDate } from '../../../src/lib/time';
import {
  COLLEGE_KINDS,
  COLLEGE_STATUSES,
  HABIT_CATEGORIES,
  HABIT_UNITS,
  type CollegeItem,
  type Habit,
} from '../../../src/types/domain';
import {
  checkDay,
  d,
  dayArg,
  norm,
  op,
  Refusal,
  resolveOne,
  text,
  type Env,
  type Tool,
} from './kit';

/*
 * Private life data over MCP (v2.1): routines (with gym sessions as fitness
 * routines), college and the inbox. Only a GLOBAL connection with the owner's
 * explicit permission for that category reaches them. Time with people is
 * never a routine (there is no such category), and Protected Time has no
 * tool at all. A log is a fact the owner reported; nothing is back-filled.
 */

const habitJson = (h: Habit) => ({
  id: h.id,
  name: h.name,
  category: h.category,
  unit: h.unit,
  ...(h.target !== undefined ? { target: h.target } : {}),
  ...(h.archived ? { archived: true } : {}),
});

async function resolveRoutine(env: Env, ref: string): Promise<Habit> {
  const data = await env.data();
  return resolveOne(
    data.habits,
    ref,
    'routine',
    (h) => h.id,
    (h) => [h.name],
    (h) => `${h.name} (${h.id})`,
  );
}

function notFuture(env: Env, day: string) {
  if (day > toLocalDate(env.at)) throw new Refusal('That day hasn’t happened yet');
  return day;
}

const routineTools: Tool[] = [
  {
    name: 'get_routines',
    title: 'Get routines',
    capability: [],
    category: 'routines',
    action: 'read routines',
    description:
      'Routines (gym types are fitness routines) and their logs for a range of days (default: the last 14).',
    write: false,
    input: z.strictObject({ from: dayArg('First day'), to: dayArg('Last day') }),
    async run(env, args) {
      const data = await env.data();
      const to = args.to ? checkDay(args.to as string, 'to') : toLocalDate(env.at);
      const from = args.from
        ? checkDay(args.from as string, 'from')
        : toLocalDate(new Date(env.at.getTime() - 13 * 86_400_000));
      return {
        value: {
          routines: data.habits.map(habitJson),
          logs: data.habitEntries
            .filter((e) => e.date >= from && e.date <= to)
            .map((e) => ({
              routine: e.habitId,
              date: e.date,
              value: e.value,
              ...(e.note ? { note: e.note } : {}),
            })),
        },
      };
    },
  },
  {
    name: 'create_routine',
    title: 'Create routine',
    capability: 'life.write',
    category: 'routines',
    action: 'create a routine',
    description:
      'Adds a routine: a check (done or not), a count or minutes, with an optional daily target. Categories: coding, learning, fitness (gym types), health, money, personal. Time with people is never a routine.',
    write: true,
    input: z.strictObject({
      name: text(120),
      category: z.enum(HABIT_CATEGORIES),
      unit: z.enum(HABIT_UNITS),
      target: d(z.optional(z.number().check(z.positive())), 'For count and minutes.'),
    }),
    async run(env, args) {
      const data = await env.data();
      const existing = data.habits.find(
        (h) => !h.archived && norm(h.name) === norm(args.name as string),
      );
      if (existing) return { value: { existing: true, routine: habitJson(existing) } };
      const h = await env.repos().habits.create({
        name: args.name as string,
        category: args.category as Habit['category'],
        unit: args.unit as Habit['unit'],
        ...(args.target ? { target: args.target as number } : {}),
      });
      return {
        value: habitJson(h),
        changes: [{ summary: `Added routine ${h.name}`, undo: [op('habits', 'archive', h.id)] }],
      };
    },
  },
  {
    name: 'update_routine',
    title: 'Update routine',
    capability: 'life.write',
    category: 'routines',
    action: 'update a routine',
    description: 'Renames a routine or changes its category or target (null clears the target).',
    write: true,
    input: z.strictObject({
      routine: text(200),
      name: z.optional(text(120)),
      category: z.optional(z.enum(HABIT_CATEGORIES)),
      target: z.optional(z.nullable(z.number().check(z.positive()))),
    }),
    async run(env, args) {
      const h = await resolveRoutine(env, args.routine as string);
      const changes: Record<string, unknown> = {};
      for (const k of ['name', 'category', 'target'] as const)
        if (args[k] !== undefined) changes[k] = args[k];
      if (!Object.keys(changes).length) throw new Refusal('Nothing to change');
      const updated = await env.repos().habits.update(h.id, changes);
      return {
        value: habitJson(updated),
        changes: [
          {
            summary: `Updated routine ${updated.name}`,
            undo: [
              op(
                'habits',
                'update',
                h.id,
                Object.fromEntries(
                  Object.keys(changes).map((k) => [
                    k,
                    (h as unknown as Record<string, unknown>)[k] ?? null,
                  ]),
                ),
              ),
            ],
          },
        ],
      };
    },
  },
  {
    name: 'archive_routine',
    title: 'Archive routine',
    capability: 'life.write',
    category: 'routines',
    action: 'archive a routine',
    description: 'Hides a routine from daily logging; its logs are kept.',
    write: true,
    input: z.strictObject({ routine: text(200) }),
    async run(env, args) {
      const h = await resolveRoutine(env, args.routine as string);
      await env.repos().habits.archive(h.id);
      return {
        value: { id: h.id, archived: true },
        changes: [{ summary: `Archived routine ${h.name}`, undo: [op('habits', 'restore', h.id)] }],
      };
    },
  },
  {
    name: 'restore_routine',
    title: 'Restore routine',
    capability: 'life.write',
    category: 'routines',
    action: 'restore a routine',
    description: 'Brings an archived routine back.',
    write: true,
    input: z.strictObject({ routine: text(200) }),
    async run(env, args) {
      const h = await resolveRoutine(env, args.routine as string);
      await env.repos().habits.restore(h.id);
      return {
        value: { id: h.id, archived: false },
        changes: [{ summary: `Restored routine ${h.name}`, undo: [op('habits', 'archive', h.id)] }],
      };
    },
  },
  {
    name: 'log_routine',
    title: 'Log routine',
    capability: 'life.write',
    category: 'routines',
    action: 'log a routine',
    description:
      'Records a routine the owner says they did, for today or a past day (never a future one): check = done; count or minutes = the amount (a gym session is a fitness routine with minutes).',
    write: true,
    input: z.strictObject({
      routine: text(200),
      date: dayArg('The day (default today)'),
      value: d(z.optional(z.number().check(z.positive())), 'For count and minutes.'),
      note: z.optional(text(500)),
    }),
    async run(env, args) {
      const h = await resolveRoutine(env, args.routine as string);
      const date = notFuture(
        env,
        args.date ? checkDay(args.date as string, 'date') : toLocalDate(env.at),
      );
      if (h.unit !== 'check' && args.value === undefined)
        throw new Refusal(h.unit === 'minutes' ? 'How many minutes?' : 'How many?');
      const data = await env.data();
      const before = data.habitEntries.find((e) => e.habitId === h.id && e.date === date);
      const entry = await env
        .repos()
        .habits.setEntry(
          h.id,
          date,
          h.unit === 'check' ? 1 : (args.value as number),
          args.note as string | undefined,
        );
      return {
        value: { routine: h.name, date, value: entry.value },
        changes: [
          {
            summary: `Logged ${h.name} for ${date}${h.unit === 'check' ? '' : ` (${entry.value}${h.unit === 'minutes' ? ' min' : ''})`}`,
            undo: [
              before
                ? op('habits', 'setEntry', h.id, date, before.value, before.note)
                : op('habits', 'clearEntry', h.id, date),
            ],
          },
        ],
      };
    },
  },
  {
    name: 'clear_routine_log',
    title: 'Clear routine log',
    capability: 'life.write',
    category: 'routines',
    action: 'clear a routine log',
    description: 'Removes a routine’s log for a day (a mistaken entry).',
    write: true,
    input: z.strictObject({ routine: text(200), date: dayArg('The day (default today)') }),
    async run(env, args) {
      const h = await resolveRoutine(env, args.routine as string);
      const date = args.date ? checkDay(args.date as string, 'date') : toLocalDate(env.at);
      const before = (await env.data()).habitEntries.find(
        (e) => e.habitId === h.id && e.date === date,
      );
      if (!before) throw new Refusal(`${h.name} has no log on ${date}`);
      await env.repos().habits.clearEntry(h.id, date);
      return {
        value: { routine: h.name, date, cleared: true },
        changes: [
          {
            summary: `Cleared ${h.name} on ${date}`,
            undo: [op('habits', 'setEntry', h.id, date, before.value, before.note)],
          },
        ],
      };
    },
  },
];

const collegeJson = (c: CollegeItem) => ({
  id: c.id,
  kind: c.kind,
  title: c.title,
  date: c.date,
  status: c.status,
  ...(c.course ? { course: c.course } : {}),
  ...(c.note ? { note: c.note } : {}),
});

const collegeTools: Tool[] = [
  {
    name: 'get_college',
    title: 'Get college',
    capability: [],
    category: 'college',
    action: 'read college',
    description:
      'Classes, labs, assignments, exams and events in a range of days (default: the next 30).',
    write: false,
    input: z.strictObject({ from: dayArg('First day'), to: dayArg('Last day') }),
    async run(env, args) {
      const data = await env.data();
      const from = args.from ? checkDay(args.from as string, 'from') : toLocalDate(env.at);
      const to = args.to
        ? checkDay(args.to as string, 'to')
        : toLocalDate(new Date(env.at.getTime() + 30 * 86_400_000));
      return {
        value: data.collegeItems
          .filter((c) => c.date >= from && c.date <= to)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(collegeJson),
      };
    },
  },
  {
    name: 'create_college_item',
    title: 'Create college item',
    capability: 'life.write',
    category: 'college',
    action: 'create a college item',
    description: 'Adds a class, lab, assignment, exam or event on a day.',
    write: true,
    input: z.strictObject({
      kind: z.enum(COLLEGE_KINDS),
      title: text(300),
      date: d(text(10), 'YYYY-MM-DD.'),
      course: z.optional(text(200)),
      note: z.optional(text(2000)),
    }),
    async run(env, args) {
      const item = await env.repos().college.create({
        kind: args.kind as CollegeItem['kind'],
        title: args.title as string,
        date: checkDay(args.date as string, 'date'),
        ...(args.course ? { course: args.course as string } : {}),
        ...(args.note ? { note: args.note as string } : {}),
      });
      return {
        value: collegeJson(item),
        changes: [
          {
            summary: `Added ${item.kind} “${item.title}” on ${item.date}`,
            undo: [op('college', 'update', item.id, { status: 'cancelled' })],
          },
        ],
      };
    },
  },
  {
    name: 'update_college_item',
    title: 'Update college item',
    capability: 'life.write',
    category: 'college',
    action: 'update a college item',
    description:
      'Changes a college item, or records it as attended, missed, done or cancelled (as the owner reports).',
    write: true,
    input: z.strictObject({
      item: d(text(300), 'Id or title.'),
      title: z.optional(text(300)),
      date: dayArg('Day'),
      status: z.optional(z.enum(COLLEGE_STATUSES)),
      course: z.optional(z.string().check(z.maxLength(200))),
      note: z.optional(z.string().check(z.maxLength(2000))),
    }),
    async run(env, args) {
      const data = await env.data();
      const item = resolveOne(
        data.collegeItems,
        args.item as string,
        'college item',
        (c) => c.id,
        (c) => [c.title],
        (c) => `${c.title} (${c.id}, ${c.date})`,
      );
      const changes: Record<string, unknown> = {};
      if (args.title !== undefined) changes.title = args.title;
      if (args.date !== undefined) changes.date = checkDay(args.date as string, 'date');
      if (args.status !== undefined) changes.status = args.status;
      if (args.course !== undefined) changes.course = (args.course as string) || null;
      if (args.note !== undefined) changes.note = (args.note as string) || null;
      if (!Object.keys(changes).length) throw new Refusal('Nothing to change');
      const updated = await env.repos().college.update(item.id, changes);
      return {
        value: collegeJson(updated),
        changes: [
          {
            summary: `Updated “${item.title}”`,
            undo: [
              op(
                'college',
                'update',
                item.id,
                Object.fromEntries(
                  Object.keys(changes).map((k) => [
                    k,
                    (item as unknown as Record<string, unknown>)[k] ?? null,
                  ]),
                ),
              ),
            ],
          },
        ],
      };
    },
  },
];

const inboxTools: Tool[] = [
  {
    name: 'get_inbox',
    title: 'Get inbox',
    capability: [],
    category: 'inbox',
    action: 'read the inbox',
    description: 'Thoughts captured and not yet processed.',
    write: false,
    input: z.strictObject({}),
    async run(env) {
      const data = await env.data();
      return {
        value: data.inbox
          .filter((i) => !i.processedAt)
          .map((i) => ({ id: i.id, content: i.content, createdAt: i.createdAt })),
      };
    },
  },
  {
    name: 'capture_inbox',
    title: 'Capture to inbox',
    capability: 'life.write',
    category: 'inbox',
    action: 'capture to the inbox',
    description: 'Puts a raw thought in the owner’s inbox to sort later.',
    write: true,
    input: z.strictObject({ content: text(10_000) }),
    async run(env, args) {
      const item = await env.repos().inbox.capture(args.content as string);
      return {
        value: { id: item.id },
        changes: [
          {
            summary: `Captured “${item.content.slice(0, 80)}” to the inbox`,
            undo: [op('inbox', 'markProcessed', item.id)],
          },
        ],
      };
    },
  },
];

export const lifeTools: Tool[] = [...routineTools, ...collegeTools, ...inboxTools];
