/**
 * Shown when the LOWTIDE companion served this page but this browser isn't
 * connected to it yet (v2.3). Never fall back silently to an empty
 * browser-only LOWTIDE: the launcher connects the browser in one step.
 */
export function NotConnected({ failed }: { failed: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-fg">
      <h1 className="text-xl font-semibold">Open LOWTIDE from the LOWTIDE app</h1>
      <p className="text-sm text-fg-muted">
        {failed
          ? 'That link to LOWTIDE had expired. '
          : 'Your LOWTIDE is running, but this browser isn’t connected to it yet. '}
        Open the LOWTIDE app (in Applications or your Dock): it connects this browser and opens
        LOWTIDE in one step.
      </p>
      <button
        type="button"
        onClick={() => location.reload()}
        className="self-start rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface"
      >
        Try again
      </button>
    </main>
  );
}
