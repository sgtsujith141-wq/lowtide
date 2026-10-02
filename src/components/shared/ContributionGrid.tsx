import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
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
 * nothing depends on colour.
 *
 * Squares size themselves to the width available (v2 PHASE 011): between 6
 * px and the size's maximum, with a 3 px gap (2 px for the smallest), so a
 * year fills a wide screen at GitHub-like density and a narrow column
 * without overflowing. Only when even the
 * smallest square doesn't fit does it scroll sideways, starting at the most
 * recent weeks.
 */

const MAX_CELL = { sm: 12, md: 14, lg: 20, xl: 30 } as const;
const MIN_CELL = 6;
/** The weekday column (w-7). */
const LABELS = 28;

function fitCell(width: number, weeks: number, size: keyof typeof MAX_CELL, minCell: number) {
  for (const gap of [3, 2]) {
    const cell = Math.floor((width - LABELS - gap - 8) / weeks) - gap;
    if (cell >= 9 || gap === 2 || minCell >= 9) {
      return {
        cell: Math.max(minCell, Math.min(MAX_CELL[size], cell)),
        gap: minCell >= 9 ? 3 : gap,
      };
    }
  }
  return { cell: minCell, gap: 2 };
}
export const ContributionGrid = memo(function ContributionGrid({
  label,
  today,
  days,
  palette,
  weeks = YEAR_WEEKS,
  size = 'md',
  minCell = MIN_CELL,
  selected,
  onSelect,
  emptyLabel = 'nothing recorded',
  since,
  showDetail = false,
  surface = 'canvas',
}: {
  label: string;
  today: LocalDate;
  /** Levels and labels by date. Dates absent here are level 0. */
  days: ReadonlyMap<LocalDate, GridDay>;
  palette: GridPalette;
  weeks?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * The smallest square (px). Below it the grid scrolls sideways instead of
   * shrinking further (the Home hero keeps its squares readable on phones).
   */
  minCell?: number;
  selected?: LocalDate | null;
  onSelect?: (date: LocalDate) => void;
  emptyLabel?: string;
  /** First day to draw (short views such as "last 7 days"); earlier days stay blank. */
  since?: LocalDate;
  /** A line under the grid naming the focused or hovered day (for touch and small screens). */
  showDetail?: boolean;
  /** The background the grid sits on, so the pinned weekday labels match it. */
  surface?: 'raised' | 'canvas';
}) {
  const pinned = surface === 'canvas' ? 'bg-canvas' : 'bg-raised';
  const columns = useMemo(
    () =>
      gridColumns(today, weeks).map((column) =>
        column.map((date) => (date && since && date < since ? null : date)),
      ),
    [today, weeks, since],
  );
  const months = useMemo(() => monthLabels(columns), [columns]);
  const first = columns.flat().find((d): d is LocalDate => d !== null) ?? today;
  const [focused, setFocused] = useState<LocalDate>(selected ?? today);
  const [tip, setTip] = useState<{ date: LocalDate; x: number; y: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const helpId = `grid-help-${palette}-${weeks}`;
  const active = focused >= first && focused <= today ? focused : today;
  const outer = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ cell: Math.min(12, MAX_CELL[size]), gap: 3 });

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth;
      if (!width) return;
      const next = fitCell(width, weeks, size, minCell);
      setGeometry((g) => (g.cell === next.cell && g.gap === next.gap ? g : next));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [weeks, size, minCell]);

  const describe = (date: LocalDate): GridDay =>
    days.get(date) ?? { level: 0, label: `${longDay(date)}: ${emptyLabel}` };

  // Months whose label would be clipped under the pinned weekday column are
  // hidden while the grid is scrolled (no "c" left over from "Dec").
  const [hiddenBefore, setHiddenBefore] = useState(0);
  const pitch = geometry.cell + geometry.gap;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    const onScroll = () => setHiddenBefore(Math.ceil(el.scrollLeft / pitch));
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [weeks, pitch]);

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

  return (
    <div
      ref={outer}
      className="relative min-w-0"
      style={{
        ['--cell' as string]: `${geometry.cell}px`,
        ['--gap' as string]: `${geometry.gap}px`,
      }}
    >
      {/* The grid, its detail line and legend share the grid's own width. */}
      <div className="relative inline-block max-w-full align-top">
        <div ref={scroller} className="relative -mx-1 overflow-x-auto px-1 pt-1 pb-1">
          <div className="inline-flex flex-col gap-(--gap)">
            <div aria-hidden className="flex gap-(--gap) text-[10px] leading-3 text-fg-muted">
              <span className={`sticky left-0 z-[1] w-7 shrink-0 ${pinned}`} />
              {months.map((month, i) => (
                <span key={i} className="w-(--cell) shrink-0 overflow-visible whitespace-nowrap">
                  {i >= hiddenBefore ? month : null}
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
              className="flex flex-col gap-(--gap)"
            >
              {WEEKDAYS.map((weekday, row) => (
                <div role="row" key={row} className="flex items-center gap-(--gap)">
                  <span
                    aria-hidden
                    className={`sticky left-0 z-[1] w-7 shrink-0 text-[10px] leading-3 text-fg-muted ${pinned}`}
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
                        className={`size-(--cell) shrink-0 rounded-[2px] outline-offset-1 transition-[outline-color] duration-150 ${levelClass(
                          palette,
                          day.level,
                        )} ${
                          isSelected
                            ? 'outline-2 outline-fg outline-solid'
                            : isToday
                              ? 'ring-1 ring-fg-subtle ring-inset'
                              : ''
                        } ${onSelect ? 'cursor-pointer' : ''} hover:outline hover:outline-1 hover:outline-fg-muted`}
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
            className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-md bg-raised px-2 py-1 text-[11px] leading-snug text-fg shadow-[var(--lt-shadow)]"
            style={{ left: Math.max(60, tip.x), top: tip.y - 4 }}
          >
            {describe(tip.date).label}
          </div>
        )}
        {showDetail && (
          <p className="mt-1 min-h-4 text-xs text-fg-muted">
            {describe(tip?.date ?? active).label}
          </p>
        )}
        <div
          className="mt-1 flex items-center justify-end gap-1 text-[10px] text-fg-muted"
          aria-hidden
        >
          Less
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span
              key={level}
              className={`size-[9px] rounded-[2px] ${levelClass(palette, level)}`}
            />
          ))}
          More
        </div>
      </div>
      <p id={helpId} className="sr-only">
        One square per day, darker for more. Arrow keys move by day and week; Home and End jump to
        the first day and today{onSelect ? '; Enter shows that day' : ''}.
      </p>
    </div>
  );
});
