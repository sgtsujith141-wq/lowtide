import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDays } from '../../lib/calendar';
import type { LocalDate } from '../../types/domain';
import { levelClass } from './grid-palette';
import {
  gridColumns,
  longDay,
  monthLabels,
  YEAR_WEEKS,
  type GridPalette,
  type Level,
} from './contribution-grid';

const WEEKDAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

export interface GridDay {
  level: Level;
  /** Full text for the square: date and what it holds. */
  label: string;
}

/**
 * The LOWTIDE contribution calendar (ADR-042): GitHub geometry (7 Sunday-first
 * rows, one column per week, month labels above, Mon/Wed/Fri at the side,
 * small rounded squares with even gaps, a Less→More legend), in any palette.
 *
 * Accessible as an ARIA grid with one Tab stop: arrows move by day (↑↓) and
 * week (←→), Home/End jump to the first day and today, Enter or Space selects.
 * Hover or focus shows a tooltip; every square also has a full text label, so
 * nothing depends on colour. Scrolls sideways on narrow screens, starting at
 * the most recent weeks.
 */
export const ContributionGrid = memo(function ContributionGrid({
  label,
  today,
  days,
  palette,
  weeks = YEAR_WEEKS,
  size = 'md',
  selected,
  onSelect,
  emptyLabel = 'nothing recorded',
}: {
  label: string;
  today: LocalDate;
  /** Levels and labels by date. Dates absent here are level 0. */
  days: ReadonlyMap<LocalDate, GridDay>;
  palette: GridPalette;
  weeks?: number;
  size?: 'sm' | 'md' | 'lg';
  selected?: LocalDate | null;
  onSelect?: (date: LocalDate) => void;
  emptyLabel?: string;
}) {
  const columns = useMemo(() => gridColumns(today, weeks), [today, weeks]);
  const months = useMemo(() => monthLabels(columns), [columns]);
  const first = columns[0]?.[0] ?? today;
  const [focused, setFocused] = useState<LocalDate>(selected ?? today);
  const [tip, setTip] = useState<{ date: LocalDate; x: number; y: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const helpId = `grid-help-${palette}-${weeks}`;
  const active = focused >= first && focused <= today ? focused : today;

  const describe = (date: LocalDate): GridDay =>
    days.get(date) ?? { level: 0, label: `${longDay(date)}: ${emptyLabel}` };

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  function showTip(date: LocalDate, cell: HTMLElement) {
    const box = scroller.current;
    if (!box) return;
    setTip({
      date,
      x: cell.offsetLeft - box.scrollLeft + cell.offsetWidth / 2,
      y: cell.offsetTop,
    });
  }

  function move(to: LocalDate) {
    if (to < first || to > today) return;
    setFocused(to);
    const cell = grid.current?.querySelector<HTMLElement>(`[data-date="${to}"]`);
    cell?.focus();
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
    else if ((event.key === 'Enter' || event.key === ' ') && onSelect) onSelect(active);
    else return;
    event.preventDefault();
  }

  const cell = size === 'lg' ? 'sm:[--cell:14px]' : size === 'sm' ? '' : 'sm:[--cell:12px]';

  return (
    <div className={`relative [--cell:10px] ${cell}`}>
      <div ref={scroller} className="relative -mx-1 overflow-x-auto px-1 pt-1 pb-1">
        <div className="inline-flex flex-col gap-[3px]">
          <div aria-hidden className="flex gap-[3px] text-[10px] leading-3 text-ink-muted">
            <span className="sticky left-0 z-[1] w-7 shrink-0 bg-paper-raised" />
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
            aria-describedby={helpId}
            onKeyDown={onKeyDown}
            onMouseLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
            className="flex flex-col gap-[3px]"
          >
            {WEEKDAYS.map((weekday, row) => (
              <div role="row" key={row} className="flex items-center gap-[3px]">
                <span
                  aria-hidden
                  className="sticky left-0 z-[1] w-7 shrink-0 bg-paper-raised text-[10px] leading-3 text-ink-muted"
                >
                  {weekday}
                </span>
                {columns.map((column, col) => {
                  const date = column[row];
                  if (!date)
                    return <span key={col} aria-hidden className="size-(--cell) shrink-0" />;
                  const day = describe(date);
                  const isToday = date === today;
                  const isSelected = selected === date;
                  return (
                    <div
                      key={col}
                      role="gridcell"
                      data-date={date}
                      data-level={day.level}
                      tabIndex={date === active ? 0 : -1}
                      aria-label={day.label}
                      aria-selected={onSelect ? isSelected : undefined}
                      aria-current={isToday ? 'date' : undefined}
                      onFocus={(e) => {
                        setFocused(date);
                        showTip(date, e.currentTarget);
                      }}
                      onMouseEnter={(e) => showTip(date, e.currentTarget)}
                      onClick={() => {
                        setFocused(date);
                        onSelect?.(date);
                      }}
                      className={`size-(--cell) shrink-0 rounded-[2px] outline-offset-1 ${levelClass(
                        palette,
                        day.level,
                      )} ${
                        isSelected
                          ? 'ring-2 ring-ink ring-offset-1 ring-offset-paper-raised'
                          : isToday
                            ? 'ring-1 ring-ink-muted ring-inset'
                            : ''
                      } ${onSelect ? 'cursor-pointer' : ''} hover:outline hover:outline-1 hover:outline-ink-faint`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-md bg-ink px-2 py-1 text-[11px] leading-snug text-paper shadow-sm"
          style={{ left: Math.max(60, tip.x), top: tip.y - 4 }}
        >
          {describe(tip.date).label}
        </div>
      )}
      <div
        className="mt-1 flex items-center justify-end gap-1 text-[10px] text-ink-muted"
        aria-hidden
      >
        Less
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className={`size-[10px] rounded-[2px] ${levelClass(palette, level)}`} />
        ))}
        More
      </div>
      <p id={helpId} className="sr-only">
        One square per day, darker for more. Arrow keys move by day and week; Home and End jump to
        the first day and today{onSelect ? '; Enter shows that day' : ''}.
      </p>
    </div>
  );
});
