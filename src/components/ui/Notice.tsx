import type { ReactNode } from 'react';

/**
 * Calm inline error. Rendered with role="alert" so screen readers announce it.
 * Never pass raw error messages or stack traces: say what happened in plain words.
 */
export function ErrorNotice({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-2 text-sm text-danger">
      {children}
    </p>
  );
}

/** Visually hidden polite live region for success confirmations. */
export function Announcer({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
