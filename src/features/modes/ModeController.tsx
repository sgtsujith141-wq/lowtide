import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import type { StartWork } from '../../db/repositories';
import { useNow } from '../../hooks/useNow';
import { useRepositories } from '../../hooks/useRepositories';
import type { OffTimeSession, WorkSession } from '../../types/domain';
import { activeMs } from '../work/duration';
import { shortDuration, timeOfDay } from './clocks';
import { ModeContext, type ModeApi, type StartDefaults } from './mode-context';
import { SleepScreen } from './SleepScreen';
import { StartWorkChooser } from './StartWorkChooser';
import { useModes } from './useModes';
import { useWorkContext } from './work-context';
import { WorkFocus } from './WorkFocus';

/*
 * The mode controller (v2 PHASE 015). It owns how Work Mode and Sleep Mode
 * are entered, shown and left; the sessions themselves are unchanged
 * repository records, so a reload or a companion restart picks them up
 * exactly where they were. State changes are announced once each; timers are
 * never read out.
 */

const DORMANT_MS = 700;
const FOCUS_KEY = 'lowtide.workFocus';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readFocus(): string | null {
  try {
    return sessionStorage.getItem(FOCUS_KEY);
  } catch {
    return null;
  }
}

function writeFocus(id: string | null) {
  try {
    if (id) sessionStorage.setItem(FOCUS_KEY, id);
    else sessionStorage.removeItem(FOCUS_KEY);
  } catch {
    // A private window: Work Mode simply opens as the compact bar after a reload.
  }
}

const landOnPage = () => requestAnimationFrame(() => document.getElementById('main')?.focus());

interface Summary {
  session: WorkSession;
}

interface WakeSummary {
  session: OffTimeSession;
}

export function ModeController({ children }: { children: ReactNode }) {
  const { work: workRepo, offTime: offRepo } = useRepositories();
  const { work, offTime, ready } = useModes();
  const { pathname } = useLocation();
  const [focusFor, setFocusFor] = useState<string | null>(readFocus);
  const [chooser, setChooser] = useState<{ defaults?: StartDefaults } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [leaving, setLeaving] = useState<OffTimeSession | null>(null);
  const [woke, setWoke] = useState<WakeSummary | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const say = useCallback((message: string) => {
    // Re-announce even when the words repeat.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const focusOpen = !!work && focusFor === work.id;
  const setFocusOpen = useCallback(
    (open: boolean) => {
      const id = open && work ? work.id : null;
      setFocusFor(id);
      if (!open) landOnPage();
    },
    [work],
  );

  // Navigating elsewhere leaves Work Mode's surface for the compact bar.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (focusFor) setFocusFor(null);
  }
  // Remembered for this tab, so a reload comes back to Work Mode.
  useEffect(() => writeFocus(focusFor), [focusFor]);

  const api = useMemo<ModeApi>(
    () => ({
      ready,
      work,
      offTime,
      focusOpen,
      setFocusOpen,
      openStartWork: (defaults) => {
        if (offTime) return;
        if (work) return setFocusOpen(true);
        setChooser(defaults ? { defaults } : {});
      },
      startWork: async (input: StartWork) => {
        const session = await workRepo.start(input);
        setChooser(null);
        setFocusFor(session.id);
        say('Work started');
      },
      pause: async () => {
        if (!work) return;
        try {
          await workRepo.pause(work.id);
          say('Paused');
        } catch {
          setError('Couldn’t pause. Nothing changed.');
        }
      },
      resume: async () => {
        if (!work) return;
        try {
          await workRepo.resume(work.id);
          say('Resumed');
        } catch {
          setError('Couldn’t resume. Nothing changed.');
        }
      },
      finish: async () => {
        if (!work) return;
        try {
          const done = await workRepo.finish(work.id);
          setFocusFor(null);
          setSummary({ session: done });
          say('Finished');
        } catch {
          setError('Couldn’t finish. Nothing changed.');
        }
      },
      requestSleep: () => {
        if (offTime) return;
        if (work) {
          setConflict(true);
          return;
        }
        offRepo.start('sleep').then(
          () => say('Sleep Mode started'),
          () => setError('Couldn’t start Sleep Mode. Nothing changed.'),
        );
      },
      wake: async () => {
        if (!offTime || leaving) return;
        const session = offTime;
        setLeaving(session);
        try {
          const ended = await offRepo.end(session.id);
          const finish = () => {
            setLeaving(null);
            setWoke({ session: ended });
            say('Off time ended');
            landOnPage();
          };
          if (reducedMotion()) finish();
          else setTimeout(finish, DORMANT_MS);
        } catch {
          setLeaving(null);
          setError('Couldn’t end off time. Try again.');
        }
      },
    }),
    [ready, work, offTime, focusOpen, setFocusOpen, workRepo, offRepo, say, leaving],
  );

  // ⌘/Ctrl ⇧ Enter: start Work Mode, or return to it. (⌘⇧W would close the window.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        api.openStartWork();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [api]);

  const dormant = offTime ?? leaving;
  return (
    <ModeContext.Provider value={api}>
      {children}
      {work && focusOpen && !dormant && <WorkFocus key={work.id} session={work} />}
      {dormant && (
        <SleepScreen
          key={dormant.id}
          session={dormant}
          leaving={leaving !== null}
          onWake={() => void api.wake()}
        />
      )}
      <Modal
        open={chooser !== null}
        label="Start work"
        onClose={() => setChooser(null)}
        className="w-[min(36rem,calc(100vw-2rem))]"
      >
        {chooser && (
          <StartWorkChooser
            defaults={chooser.defaults}
            onStart={api.startWork}
            onCancel={() => setChooser(null)}
          />
        )}
      </Modal>
      <Modal
        open={conflict && !!work}
        label="Work is still running"
        onClose={() => setConflict(false)}
      >
        {conflict && work && (
          <SleepConflict
            session={work}
            onBack={() => setConflict(false)}
            onFinishAndSleep={async () => {
              await workRepo.finish(work.id);
              setFocusFor(null);
              await offRepo.start('sleep');
              setConflict(false);
              say('Work finished. Sleep Mode started');
            }}
          />
        )}
      </Modal>
      <Modal open={summary !== null} label="Work finished" onClose={() => setSummary(null)}>
        {summary && (
          <FinishSummary
            session={summary.session}
            onDone={async (note) => {
              if (note.trim()) await workRepo.describe(summary.session.id, note);
              setSummary(null);
              landOnPage();
            }}
          />
        )}
      </Modal>
      {woke && <WakeToast session={woke.session} onClose={() => setWoke(null)} />}
      {error && (
        <div
          className="fixed inset-x-0 bottom-4 z-[70] mx-auto w-fit max-w-[calc(100vw-2rem)]"
          onClick={() => setError(null)}
        >
          <ErrorNotice>{error}</ErrorNotice>
        </div>
      )}
      <Announcer message={announcement} />
    </ModeContext.Provider>
  );
}

/** A small native modal: focus moves in, Escape and the backdrop close it. */
function Modal({
  open,
  label,
  onClose,
  className = 'w-[min(26rem,calc(100vw-2rem))]',
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`lt-pop m-auto mt-[14vh] rounded-xl bg-raised p-0 text-fg shadow-[var(--lt-shadow)] backdrop:bg-scrim ${className}`}
    >
      {children}
    </dialog>
  );
}

function SleepConflict({
  session,
  onBack,
  onFinishAndSleep,
}: {
  session: WorkSession;
  onBack: () => void;
  onFinishAndSleep: () => Promise<void>;
}) {
  const now = useNow(true, 30_000);
  const { title, subtitle } = useWorkContext(session);
  const [error, setError] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);
  return (
    <div className="p-6 text-center">
      <p className="text-[15px] font-medium">Work is still running.</p>
      <p className="mt-3 text-sm text-fg-muted">
        {title}
        {subtitle ? ` · ${subtitle}` : ''}
      </p>
      <p className="figure mt-1 text-lg font-semibold">{shortDuration(activeMs(session, now))}</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button
          ref={primary}
          variant="primary"
          className="h-10"
          onClick={() => {
            setError(false);
            onFinishAndSleep().catch(() => setError(true));
          }}
        >
          Finish work &amp; sleep
        </Button>
        <Button variant="ghost" className="h-10" onClick={onBack}>
          Go back
        </Button>
      </div>
      {error && <ErrorNotice>Couldn’t do that. Nothing changed.</ErrorNotice>}
    </div>
  );
}

function FinishSummary({
  session,
  onDone,
}: {
  session: WorkSession;
  onDone: (note: string) => Promise<void>;
}) {
  const { title, subtitle } = useWorkContext(session);
  const [note, setNote] = useState('');
  const [error, setError] = useState(false);
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    done.current?.focus();
  }, []);
  const submit = () => {
    setError(false);
    onDone(note).catch(() => setError(true));
  };
  return (
    <form
      className="p-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="figure text-2xl font-semibold">Worked {shortDuration(activeMs(session))}</p>
      <p className="mt-1 text-sm">{title}</p>
      {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
      <label htmlFor="work-note" className="mt-5 block text-xs text-fg-muted">
        What changed? (optional)
      </label>
      <input
        id="work-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-line bg-canvas px-2.5 text-sm"
      />
      {error && <ErrorNotice>Couldn’t save the note. The session itself is saved.</ErrorNotice>}
      <div className="mt-5 flex justify-end">
        <Button ref={done} type="submit" variant="primary" className="h-9 px-5">
          Done
        </Button>
      </div>
    </form>
  );
}

/** After waking: a small, passing summary of the off time just ended. */
function WakeToast({ session, onClose }: { session: OffTimeSession; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 10_000);
    return () => clearTimeout(t);
  }, [onClose]);
  const start = session.startedAt ?? session.createdAt;
  const end = session.endedAt ?? start;
  return (
    <div
      role="status"
      aria-label="Off time ended"
      className="lt-pop fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[70] mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-4 rounded-lg border border-line bg-raised px-4 py-2.5 text-sm shadow-[var(--lt-shadow)]"
    >
      <span>
        <span className="text-fg-muted">{session.kind === 'rest' ? 'Rest' : 'Off time'}</span>{' '}
        <span className="figure font-semibold">
          {shortDuration(Date.parse(end) - Date.parse(start))}
        </span>
        <span className="figure ml-2 text-fg-muted">
          {timeOfDay(start)} → {timeOfDay(end)}
        </span>
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="grid size-6 place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
