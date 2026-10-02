/** "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export const shortcutLabel = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
