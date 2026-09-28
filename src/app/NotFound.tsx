import { Link } from 'react-router';

export function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="font-serif text-2xl font-semibold">Nothing here</h1>
      <p className="mt-2 text-ink-muted">
        <Link to="/" className="text-accent-ink underline underline-offset-2">
          Back to LOWTIDE
        </Link>
      </p>
    </main>
  );
}
