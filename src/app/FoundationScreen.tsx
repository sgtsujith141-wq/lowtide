import { Waves } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SCHEMA_VERSION } from '../db/schema';
import { useRepositories } from '../hooks/useRepositories';

type DbState =
  { kind: 'checking' } | { kind: 'ready'; inboxCount: number } | { kind: 'error'; message: string };

/**
 * Temporary PHASE 000 screen: proves the app boots and the local database
 * opens through the repository layer. Replaced in PHASE 001.
 */
export function FoundationScreen() {
  const { inbox } = useRepositories();
  const [db, setDb] = useState<DbState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    inbox.countUnprocessed().then(
      (inboxCount) => active && setDb({ kind: 'ready', inboxCount }),
      (error: unknown) => active && setDb({ kind: 'error', message: String(error) }),
    );
    return () => {
      active = false;
    };
  }, [inbox]);

  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="flex items-center gap-2 font-serif text-3xl font-semibold tracking-tight">
        <Waves aria-hidden className="size-7 text-accent" strokeWidth={1.75} />
        LOWTIDE
      </h1>
      <p className="mt-2 text-ink-muted">
        Foundation is operational. The real app starts in PHASE 001.
      </p>

      <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
        <div className="flex justify-between py-2">
          <dt className="text-ink-muted">Local database</dt>
          <dd role="status">
            {db.kind === 'checking' && 'Opening…'}
            {db.kind === 'ready' && <span className="text-accent-ink">Ready</span>}
            {db.kind === 'error' && <span className="text-danger">Unavailable: {db.message}</span>}
          </dd>
        </div>
        <div className="flex justify-between py-2">
          <dt className="text-ink-muted">Schema version</dt>
          <dd>{SCHEMA_VERSION}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt className="text-ink-muted">Unprocessed inbox items</dt>
          <dd>{db.kind === 'ready' ? db.inboxCount : '—'}</dd>
        </div>
      </dl>
    </main>
  );
}
