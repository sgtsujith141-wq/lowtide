/*
 * Appearance (ADR-061): Auto follows the operating system; Light and Dark
 * force one. Stored per browser. `<html data-theme>` carries a forced
 * choice (index.html applies it before the first paint); Sleep Mode dims
 * whichever theme is showing and never changes this setting.
 */

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = 'lowtide-theme';

export function readTheme(storage: Pick<Storage, 'getItem'> = localStorage): Theme {
  try {
    const value = storage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function saveTheme(
  theme: Theme,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
) {
  try {
    if (theme === 'auto') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or storage disabled: the choice still applies to this visit.
  }
  applyTheme(theme);
}
