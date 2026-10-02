import { Moon, Play, Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useNow } from '../../hooks/useNow';
import type { WorkSession } from '../../types/domain';
import { shortcutLabel } from '../home/shortcut';
import { activeMs, isPaused } from '../work/duration';
import { shortDuration } from './clocks';
import { useModeApi, workShortcutLabel } from './mode-context';
import { useWorkContext } from './work-context';

/**
 * Start Work, Sleep and search, side by side (v2 PHASE 015). Start Work
 * opens the chooser; while work runs, this becomes the way back into it.
 */
export function ModeActions({ onAsk }: { onAsk?: () => void }) {
  const api = useModeApi();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {api.work ? (
        <ActiveWork session={api.work} />
      ) : (
        <Button
          variant="primary"
          disabled={!api.ready || !!api.offTime}
          onClick={() => api.openStartWork()}
          aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
          title={`Start work (${workShortcutLabel()})`}
          className="h-9 px-3.5"
        >
          <Play aria-hidden className="size-4" /> Start Work
        </Button>
      )}
      <Button
        aria-label="Sleep Mode"
        onClick={api.requestSleep}
        disabled={!api.ready || !!api.offTime}
        className="h-9 px-3.5"
      >
        <Moon aria-hidden className="size-4" /> Sleep
      </Button>
      {onAsk && (
        <Button
          onClick={onAsk}
          aria-label={`Search LOWTIDE (${shortcutLabel()})`}
          aria-keyshortcuts="Meta+K Control+K"
          className="h-9 px-3"
        >
          <Search aria-hidden className="size-4" />
          <kbd className="font-sans text-xs text-fg-muted">{shortcutLabel()}</kbd>
        </Button>
      )}
    </div>
  );
}

/** The session running now, and the way back into Work Mode. */
function ActiveWork({ session }: { session: WorkSession }) {
  const api = useModeApi();
  const paused = isPaused(session);
  const now = useNow(!paused, 30_000);
  const { title } = useWorkContext(session);
  return (
    <Button variant="primary" onClick={() => api.setFocusOpen(true)} className="h-9 px-3.5">
      <span aria-hidden className={`size-2 rounded-full bg-work-3 ${paused ? 'opacity-40' : ''}`} />
      {paused ? 'Paused' : 'Working'} · {title} · {shortDuration(activeMs(session, now))}
      <span className="sr-only">. Open Work Mode</span>
    </Button>
  );
}
