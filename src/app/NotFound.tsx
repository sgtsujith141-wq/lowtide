import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFound() {
  useDocumentTitle('Not found');
  return (
    <>
      <h1 className="text-page font-semibold">Nothing here</h1>
      <p className="mt-2 text-sm text-fg-muted">
        <Link to="/" className="text-accent-ink underline underline-offset-2">
          Back to LOWTIDE
        </Link>
      </p>
    </>
  );
}
