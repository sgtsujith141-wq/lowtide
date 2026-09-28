import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFound() {
  useDocumentTitle('Not found');
  return (
    <>
      <h1 className="font-serif text-xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-sm text-ink-muted">
        <Link to="/" className="text-accent-ink underline underline-offset-2">
          Back to LOWTIDE
        </Link>
      </p>
    </>
  );
}
