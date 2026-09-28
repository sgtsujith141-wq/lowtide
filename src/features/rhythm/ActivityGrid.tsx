import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDays } from '../../lib/calendar';
import type { LocalDate } from '../../types/domain';
import { monthLabels, type GridDay, type GridWeek } from './grid';
import { LEVEL_CLASS } from './levels';

const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/**
 * Contribution-style grid (ADR-026). ARIA grid: 7 rows (Mon…Sun), one column
 * per week. One Tab stop (roving tabindex); arrows move by day (↑↓) and week
 * (←→), Home/End jump to the first day and today. Every square has a full text
 * label, and the line under the grid shows the focused or hovered day, so
 * nothing depends on colour or on hovering.
 */
export function ActivityGrid({
  weeks,
  today,
  label,
}: {
  weeks: readonly GridWeek[];
  today: LocalDate;
  label: string;
}) {
  const days = useMemo(() => {
    const map = new Map<LocalDate, GridDay>();
    for (const week of weeks) for (const day of week) if (day) map.set(day.date, day);
    return map;
  }, [weeks]);
  const first = weeks[0]?.[0]?.date ?? today;
  const [focused, setFocused] = useState<LocalDate>(today);
  const [hovered, setHovered] = useState<LocalDate | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const active = days.has(focused) ? focused : today;
  const shown = days.get(hovered ?? active);
  const months = monthLabels(weeks);

  // Start scrolled to the most recent weeks on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  function move(to: LocalDate) {
    if (!days.has(to)) return;
    setFocused(to);
    grid.current?.querySelector<HTMLElement>(`[data-date="${to}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7,
    };
    if (event.key in steps) move(addDays(active, steps[event.key]!));
    else if (event.key === 'Home') move(first);
    else if (event.key === 'End') move(today);
    else return;
    event.preventDefault();
  }

  return (
    <div>
      <div
        ref={scroller}
        className="-mx-1 overflow-x-auto px-1 pb-1 [--cell:11px] sm:[--cell:15px]"
      >
        <div className="inline-flex flex-col gap-[3px]">
          <div aria-hidden className="flex gap-[3px] pl-8 text-[10px] leading-3 text-ink-muted">
            {months.map((month, i) => (
              <span key={i} className="w-(--cell) shrink-0 overflow-visible whitespace-nowrap">
                {month}
              </span>
            ))}
          </div>
          <div
            ref={grid}
            role="grid"
            aria-label={label}
            aria-describedby="activity-grid-help"
            onKeyDown={onKeyDown}
            onMouseLeave={() => setHovered(null)}
            className="flex flex-col gap-[3px]"
          >
            {WEEKDAY_LABELS.map((weekday, row) => (
              <div role="row" key={row} className="flex items-center gap-[3px]">
                <span aria-hidden className="w-8 shrink-0 text-[10px] leading-3 text-ink-muted">
                  {weekday}
                </span>
                {weeks.map((week, col) => {
                  const day = week[row];
                  if (!day)
                    return <span key={col} aria-hidden className="size-(--cell) shrink-0" />;
                  const isToday = day.date === today;
                  return (
                    <div
                      key={col}
                      role="gridcell"
                      data-date={day.date}
                      tabIndex={day.date === active ? 0 : -1}
                      aria-label={day.label}
                      aria-current={isToday ? 'date' : undefined}
                      title={day.label}
                      onFocus={() => setFocused(day.date)}
                      onMouseEnter={() => setHovered(day.date)}
                      className={`size-(--cell) shrink-0 rounded-[2px] ${LEVEL_CLASS[day.level]} ${
                        isToday ? 'ring-1 ring-ink-muted ring-offset-1 ring-offset-paper' : ''
                      } focus-visible:outline-offset-1`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-h-4 text-xs text-ink-muted">{shown?.label}</p>
        <p aria-hidden className="flex items-center gap-1 text-[10px] text-ink-muted">
          Less
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className={`size-[11px] rounded-[2px] ${LEVEL_CLASS[level]}`} />
          ))}
          More
        </p>
      </div>
      <p id="activity-grid-help" className="sr-only">
        Shaded by recorded activity: none, light, moderate, strong, high. Arrow keys move by day and
        week; Home and End jump to the first day and today.
      </p>
    </div>
  );
}
