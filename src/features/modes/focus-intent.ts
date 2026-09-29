/*
 * Focus after a mode change (ADR-030 style): the control that started work or
 * Sleep Mode disappears or becomes disabled, so focus moves to the mode bar's
 * primary button. Only when the change came from this tab's UI: a reload or
 * another tab never steals focus.
 */
let pending = false;

export function requestModeFocus() {
  pending = true;
}

export function consumeModeFocus(): boolean {
  const was = pending;
  pending = false;
  return was;
}
