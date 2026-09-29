import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContributionGrid } from '../components/shared/ContributionGrid';
import {
  gridColumns,
  gridStart,
  monthLabels,
  sundayOf,
  weeksForDays,
  YEAR_WEEKS,
} from '../components/shared/contribution-grid';
import { levelClass } from '../components/shared/grid-palette';
import { addDays } from '../lib/calendar';

const today = '2026-09-30'; // a Wednesday

describe('contribution grid geometry (GitHub layout)', () => {
  it('finds the Sunday of any week', () => {
    expect(sundayOf('2026-09-30')).toBe('2026-09-27');
    expect(sundayOf('2026-09-27')).toBe('2026-09-27');
    expect(sundayOf('2026-10-03')).toBe('2026-09-27');
    expect(sundayOf('2027-01-01')).toBe('2026-12-27');
  });

  it('lays out 53 Sunday-first weeks ending with today, and nothing after today', () => {
    const columns = gridColumns(today);
    expect(columns).toHaveLength(YEAR_WEEKS);
    expect(columns.every((c) => c.length === 7)).toBe(true);
    expect(columns[0]![0]).toBe(gridStart(today));
    expect(gridStart(today)).toBe(addDays('2026-09-27', -7 * 52));
    const last = columns.at(-1)!;
    expect(last).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      null,
      null,
      null,
    ]);
    const dates = columns.flat().filter(Boolean);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.length).toBe(52 * 7 + 4);
  });

  it('labels months where a new month starts, never closer than three weeks', () => {
    const labels = monthLabels(gridColumns(today));
    const shown = labels.filter(Boolean);
    expect(shown.length).toBeGreaterThanOrEqual(11);
    const positions = labels.flatMap((l, i) => (l ? [i] : []));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]! - positions[i - 1]!).toBeGreaterThanOrEqual(3);
    }
    expect(labels.at(-1) === null || labels.at(-1) === 'Sep').toBe(true);
  });

  it('sizes shorter views', () => {
    expect(weeksForDays(7)).toBe(2);
    expect(weeksForDays(30)).toBe(6);
    expect(weeksForDays(365)).toBe(54);
  });

  it('has a class for every palette and level, with a theme-adaptive empty level', () => {
    expect(levelClass('pulse', 0)).toBe('bg-grid-0');
    expect(levelClass('gym', 0)).toBe('bg-grid-0');
    expect(levelClass('pulse', 4)).toBe('bg-pulse-4');
    expect(levelClass('sleep', 2)).toBe('bg-sleep-2');
  });
});

describe('ContributionGrid', () => {
  const days = new Map([
    ['2026-09-29', { level: 3 as const, label: 'Tuesday 29 September 2026: strong' }],
  ]);

  it('is an ARIA grid: 7 rows, one labelled cell per day, empty days labelled too', () => {
    render(<ContributionGrid label="Pulse" today={today} days={days} palette="pulse" />);
    const grid = screen.getByRole('grid', { name: 'Pulse' });
    expect(within(grid).getAllByRole('row')).toHaveLength(7);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(52 * 7 + 4);
    const tuesday = within(grid).getByRole('gridcell', { name: /29 September 2026: strong/ });
    expect(tuesday).toHaveAttribute('data-level', '3');
    expect(tuesday.className).toContain('bg-pulse-3');
    const empty = within(grid).getByRole('gridcell', {
      name: /28 September 2026: nothing recorded/,
    });
    expect(empty).toHaveAttribute('data-level', '0');
    expect(within(grid).getByRole('gridcell', { current: 'date' })).toHaveAttribute(
      'data-date',
      today,
    );
  });

  it('has one Tab stop and moves by day, week, Home and End; Enter selects', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ContributionGrid
        label="Pulse"
        today={today}
        days={days}
        palette="pulse"
        onSelect={onSelect}
      />,
    );
    const focusable = screen
      .getAllByRole('gridcell')
      .filter((c) => c.getAttribute('tabindex') === '0');
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toHaveAttribute('data-date', today);
    focusable[0]!.focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-29');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-22');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    // Can't move past today.
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-29');
    await user.keyboard('{Home}');
    expect(document.activeElement).toHaveAttribute('data-date', gridStart(today));
    await user.keyboard('{End}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(today);
  });

  it('shows the day’s label in a tooltip on focus and hover', () => {
    render(<ContributionGrid label="Pulse" today={today} days={days} palette="work" />);
    const cell = screen.getByRole('gridcell', { name: /29 September 2026: strong/ });
    fireEvent.focus(cell);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tuesday 29 September 2026: strong');
    fireEvent.mouseLeave(screen.getByRole('grid'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('marks the selected day', () => {
    render(
      <ContributionGrid
        label="Pulse"
        today={today}
        days={days}
        palette="pulse"
        selected="2026-09-29"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('gridcell', { name: /29 September 2026/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
