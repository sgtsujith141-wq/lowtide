import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { formatFull, formatWhen } from '../../lib/when';
import { CaptureComposer } from '../inbox/CaptureComposer';

const RECENT = 5;

/** Home: capture first. The only context is what's already waiting. */
export function HomePage() {
  useDocumentTitle('LOWTIDE');
  const { inbox } = useRepositories();
  const items = useWatch(inbox.watchUnprocessed);
  const now = new Date();

  return (
    <>
      <CaptureComposer autoFocus />

      {items.status === 'ready' && (
        <section aria-labelledby="waiting-heading" className="mt-8">
          {items.data.length === 0 ? (
            <p className="text-sm text-ink-muted">Your inbox is clear.</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
                <h2 id="waiting-heading" className="text-sm font-medium text-ink-muted">
                  Waiting in your inbox
                </h2>
                <Link
                  to="/inbox"
                  className="inline-flex items-center gap-1 text-sm text-accent-ink hover:underline"
                >
                  Sort through {items.data.length === 1 ? 'it' : `all ${items.data.length}`}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
              <ul>
                {items.data
                  .slice(-RECENT)
                  .reverse()
                  .map((item) => (
                    <li key={item.id} className="flex gap-3 border-b border-line py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{item.content}</span>
                      <time
                        dateTime={item.createdAt}
                        title={formatFull(item.createdAt)}
                        className="shrink-0 text-xs text-ink-muted tabular-nums"
                      >
                        {formatWhen(item.createdAt, now)}
                      </time>
                    </li>
                  ))}
              </ul>
              {items.data.length > RECENT && (
                <p className="mt-1.5 text-xs text-ink-muted">
                  and {items.data.length - RECENT} older
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
