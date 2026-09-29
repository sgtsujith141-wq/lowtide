import type { GridPalette, Level } from './contribution-grid';

/** Static class strings (Tailwind only sees literal class names). */
const PALETTE: Record<GridPalette, Record<Exclude<Level, 0>, string>> = {
  pulse: { 1: 'bg-pulse-1', 2: 'bg-pulse-2', 3: 'bg-pulse-3', 4: 'bg-pulse-4' },
  work: { 1: 'bg-work-1', 2: 'bg-work-2', 3: 'bg-work-3', 4: 'bg-work-4' },
  sleep: { 1: 'bg-sleep-1', 2: 'bg-sleep-2', 3: 'bg-sleep-3', 4: 'bg-sleep-4' },
  personal: { 1: 'bg-personal-1', 2: 'bg-personal-2', 3: 'bg-personal-3', 4: 'bg-personal-4' },
  gym: { 1: 'bg-gym-1', 2: 'bg-gym-2', 3: 'bg-gym-3', 4: 'bg-gym-4' },
  college: { 1: 'bg-college-1', 2: 'bg-college-2', 3: 'bg-college-3', 4: 'bg-college-4' },
  projects: { 1: 'bg-projects-1', 2: 'bg-projects-2', 3: 'bg-projects-3', 4: 'bg-projects-4' },
};

export function levelClass(palette: GridPalette, level: Level): string {
  return level === 0 ? 'bg-grid-0' : PALETTE[palette][level];
}
