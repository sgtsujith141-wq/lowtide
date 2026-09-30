/** Shown if a screen crashes while rendering. No stack traces, no jargon. */
export function RouteError() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-page font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-fg-muted">
        This screen couldn’t be shown. Your saved data is stored on this device; reloading usually
        helps.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 h-8 rounded-md border border-line-strong bg-raised px-3 text-[13px] font-medium hover:bg-hover"
      >
        Reload
      </button>
    </main>
  );
}
