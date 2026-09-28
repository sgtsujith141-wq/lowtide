import { format } from 'date-fns';
import { addDays, daysBetween } from '../../lib/calendar';
import { fromLocalDate } from '../../lib/time';
import type { Hackathon, LocalDate } from '../../types/domain';

/*
 * Hackathon dates are LocalDates (ADR-027); everything here is calendar-day
 * arithmetic against today's LocalDate. Pure and unit-tested (ADR-028/029).
 */

export type MomentTone = 'past' | 'now' | 'today' | 'soon' | 'later';

export interface Moment {
  kind: 'registration' | 'event';
  date: LocalDate;
  tone: MomentTone;
  /** Always states the meaning in words; tone only adds emphasis. */
  text: string;
}

export const isOpen = (h: Hackathon) => h.status === 'considering' || h.status === 'active';

/** Registration still needs doing and has a deadline. Registered/waitlisted/rejected don't. */
export const registrationPending = (h: Hackathon) =>
  h.registrationStatus === 'not_registered' && h.registrationDeadline !== undefined;

const eventLastDay = (h: Hackathon) => h.eventEnd ?? h.eventStart;

function day(date: LocalDate, today: LocalDate): string {
  const d = fromLocalDate(date);
  return format(d, date.slice(0, 4) === today.slice(0, 4) ? 'd MMM' : 'd MMM yyyy');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "28 Sep", "28–29 Sep", "30 Sep – 2 Oct", with the year only when it isn't this year's. */
export function formatRange(
  start: LocalDate,
  end: LocalDate | undefined,
  today: LocalDate,
): string {
  if (!end || end === start) return day(start, today);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const showYear = !sameYear || start.slice(0, 4) !== today.slice(0, 4);
  const s = fromLocalDate(start);
  const e = fromLocalDate(end);
  if (sameYear && start.slice(5, 7) === end.slice(5, 7)) {
    return `${format(s, 'd')}–${format(e, showYear ? 'd MMM yyyy' : 'd MMM')}`;
  }
  return `${format(s, showYear && !sameYear ? 'd MMM yyyy' : 'd MMM')} – ${format(e, showYear ? 'd MMM yyyy' : 'd MMM')}`;
}

export function registrationMoment(h: Hackathon, today: LocalDate): Moment | null {
  if (!registrationPending(h)) return null;
  const date = h.registrationDeadline!;
  const d = daysBetween(today, date);
  const base = { kind: 'registration' as const, date };
  if (d < 0) return { ...base, tone: 'past', text: `Registration closed ${plural(-d, 'day')} ago` };
  if (d === 0) return { ...base, tone: 'today', text: 'Registration due today' };
  if (d === 1) return { ...base, tone: 'soon', text: 'Registration due tomorrow' };
  if (d < 7) return { ...base, tone: 'soon', text: `Registration due in ${d} days` };
  return { ...base, tone: 'later', text: `Registration due ${day(date, today)}` };
}

export function eventMoment(h: Hackathon, today: LocalDate): Moment | null {
  if (!h.eventStart) return null;
  const start = h.eventStart;
  const last = eventLastDay(h)!;
  const s = daysBetween(today, start);
  const e = daysBetween(today, last);
  const base = { kind: 'event' as const, date: start };
  if (s <= 0 && e >= 0) {
    return { ...base, tone: 'now', text: start === last ? 'Happening today' : 'Happening now' };
  }
  if (e < 0) {
    return {
      ...base,
      tone: 'past',
      text: -e < 7 ? `Ended ${plural(-e, 'day')} ago` : `Ended ${day(last, today)}`,
    };
  }
  if (s === 1) return { ...base, tone: 'soon', text: 'Starts tomorrow' };
  if (s < 7) return { ...base, tone: 'soon', text: `Starts in ${s} days` };
  return { ...base, tone: 'later', text: `Starts ${day(start, today)}` };
}

/**
 * Ordering (ADR-028). Group 0: upcoming, keyed by the earliest of
 * - the registration deadline, if registration is still pending and it's today or later;
 * - the event start, if the event hasn't ended (an ongoing event keys on its start, so it
 *   sorts first).
 * Group 1: no dates at all. Group 2: only past dates (ended events, passed deadlines),
 * most recent first. Ties: createdAt, then name, then id. Status is never changed here.
 */
function sortKey(h: Hackathon, today: LocalDate): { group: 0 | 1 | 2; date: LocalDate } {
  const upcoming: LocalDate[] = [];
  if (registrationPending(h) && h.registrationDeadline! >= today)
    upcoming.push(h.registrationDeadline!);
  if (h.eventStart && eventLastDay(h)! >= today) upcoming.push(h.eventStart);
  if (upcoming.length) return { group: 0, date: upcoming.sort()[0]! };
  const past = [h.registrationDeadline, h.eventStart, h.eventEnd].filter(
    (d): d is LocalDate => !!d,
  );
  if (past.length === 0) return { group: 1, date: '' };
  return { group: 2, date: past.sort().at(-1)! };
}

export function orderHackathons(list: readonly Hackathon[], today: LocalDate): Hackathon[] {
  const keys = new Map(list.map((h) => [h.id, sortKey(h, today)]));
  return [...list].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;
    if (ka.group !== kb.group) return ka.group - kb.group;
    const byDate = ka.group === 2 ? kb.date.localeCompare(ka.date) : ka.date.localeCompare(kb.date);
    return (
      byDate ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
}

/**
 * The one line that says where a hackathon stands in time: the moment its
 * ordering is keyed on (registration wins a tie), or for past-only records
 * the most useful past fact.
 */
export function primaryMoment(h: Hackathon, today: LocalDate): Moment | null {
  const reg = registrationMoment(h, today);
  const event = eventMoment(h, today);
  const regUpcoming = reg && reg.tone !== 'past' ? reg : null;
  const eventCurrent = event && event.tone !== 'past' ? event : null;
  if (regUpcoming && eventCurrent)
    return regUpcoming.date <= eventCurrent.date ? regUpcoming : eventCurrent;
  return regUpcoming ?? eventCurrent ?? reg ?? event;
}

export const TODAY_WINDOW_DAYS = 7;
export const TODAY_LIMIT = 3;

export interface TodayHackathon {
  hackathon: Hackathon;
  /** e.g. "Registration due tomorrow · Starts in 4 days" — one row even with two reasons. */
  label: string;
}

/**
 * Today's hackathon rows (ADR-029). Open (considering/active), not rejected, and:
 * - registration pending with a deadline overdue or within the next 7 days, or
 * - the event starts within the next 7 days, or is happening now.
 * One row per hackathon, most urgent first, at most 3; `more` counts the rest.
 */
export function hackathonsForToday(
  list: readonly Hackathon[],
  today: LocalDate,
): { rows: TodayHackathon[]; more: number } {
  const horizon = addDays(today, TODAY_WINDOW_DAYS);
  const relevant: { hackathon: Hackathon; date: LocalDate; label: string }[] = [];

  for (const h of list) {
    if (!isOpen(h) || h.registrationStatus === 'rejected') continue;
    const reg =
      registrationPending(h) && h.registrationDeadline! <= horizon
        ? registrationMoment(h, today)
        : null;
    const event = eventMoment(h, today);
    const eventRelevant =
      event && (event.tone === 'now' || (event.tone !== 'past' && h.eventStart! <= horizon));
    if (!reg && !eventRelevant) continue;
    const labels = [reg?.text, eventRelevant ? event.text : undefined].filter(Boolean);
    const dates = [reg?.date, eventRelevant ? h.eventStart : undefined].filter(
      (d): d is LocalDate => !!d,
    );
    relevant.push({ hackathon: h, date: dates.sort()[0]!, label: labels.join(' · ') });
  }

  relevant.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.hackathon.createdAt.localeCompare(b.hackathon.createdAt) ||
      a.hackathon.name.localeCompare(b.hackathon.name) ||
      a.hackathon.id.localeCompare(b.hackathon.id),
  );
  return {
    rows: relevant.slice(0, TODAY_LIMIT).map(({ hackathon, label }) => ({ hackathon, label })),
    more: Math.max(0, relevant.length - TODAY_LIMIT),
  };
}
