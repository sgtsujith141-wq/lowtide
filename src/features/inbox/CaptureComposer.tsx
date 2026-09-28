import { CornerDownLeft } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';

/**
 * Brain dump: type, press Enter, keep going. No fields to fill, no choices.
 * Enter (or Cmd/Ctrl+Enter) saves, Shift+Enter adds a line. While an IME is
 * composing, Enter belongs to the IME and never saves.
 *
 * Saving takes the textarea's current text and clears the box at once, so
 * you can keep typing; saves run one after another in order. If a save fails,
 * its text is put back (ahead of anything typed since) with an error, so a
 * thought is never silently lost. Success is announced only after the write.
 */
export function CaptureComposer({ autoFocus = false }: { autoFocus?: boolean }) {
  const { inbox } = useRepositories();
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [saves, setSaves] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  function save() {
    // Read the DOM, not render state: a keypress can arrive before re-render.
    const text = textarea.current?.value ?? '';
    if (!text.trim()) return;
    setDraft('');
    queue.current = queue.current.then(async () => {
      try {
        await inbox.capture(text);
        setFailed(false);
        setSaves((n) => n + 1);
      } catch {
        setDraft((current) => (current.trim() ? `${text}\n${current}` : text));
        setFailed(true);
      }
    });
    textarea.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // keyCode 229: Safari reports IME Enter this way without isComposing.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    save();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save();
  }

  return (
    <form onSubmit={onSubmit}>
      <h1 className="mb-2 font-serif text-xl font-semibold tracking-tight">
        <label htmlFor={`${id}-text`}>What’s taking up space?</label>
      </h1>
      <textarea
        ref={textarea}
        id={`${id}-text`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        rows={3}
        placeholder="Anything. It goes to your inbox; sort it out later."
        aria-describedby={failed ? `${id}-error` : `${id}-hint`}
        aria-invalid={failed || undefined}
        className={`${fieldClass} max-h-[40vh] min-h-[5.5rem] resize-none text-base leading-relaxed [field-sizing:content]`}
      />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          <kbd className="font-sans">Enter</kbd> saves ·{' '}
          <kbd className="font-sans">Shift+Enter</kbd> new line
        </p>
        <Button type="submit" variant="ghost" disabled={!draft.trim()}>
          <CornerDownLeft aria-hidden className="size-4" />
          Save
        </Button>
      </div>
      {failed && (
        <ErrorNotice id={`${id}-error`}>
          Couldn’t save that — it’s still here. Press Enter to try again.
        </ErrorNotice>
      )}
      <Announcer message={saves === 0 ? '' : saves % 2 ? 'Saved to inbox.' : 'Saved.'} />
    </form>
  );
}
