import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/** Navigation state that asks a page to open its own creation form. */
export const CREATE = { create: true } as const;

/**
 * Runs `open` when the page is reached with {@link CREATE} (the command
 * palette's “New …” commands), once per navigation, including when the page
 * is already showing.
 */
export function useCreateRequest(open: () => void) {
  const location = useLocation();
  const latest = useRef(open);
  useLayoutEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    if ((location.state as { create?: unknown } | null)?.create === true) latest.current();
  }, [location.key, location.state]);
}
