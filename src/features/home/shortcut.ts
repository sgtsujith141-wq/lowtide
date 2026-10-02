/** Asks the shell to open the command palette (⌘K), from anywhere. */
export const PALETTE_EVENT = 'lowtide:palette';
export function openPalette() {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export const shortcutLabel = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
