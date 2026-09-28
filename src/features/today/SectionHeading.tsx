import type { ReactNode } from 'react';

/** Quiet section heading with a rule; focusable so focus can land here. */
export function SectionHeading({
  id,
  children,
  action,
}: {
  id: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-end justify-between gap-3 border-b border-line pb-1">
      <h2 id={id} tabIndex={-1} className="text-sm font-medium text-ink-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}
