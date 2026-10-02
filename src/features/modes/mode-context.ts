import { createContext, useContext } from 'react';
import type { StartWork } from '../../db/repositories';
import type { Id, OffTimeSession, WorkSession } from '../../types/domain';

/*
 * The two global modes, as one controller the whole app shares (v2 PHASE
 * 015). The sessions themselves live in the repositories, exactly as before;
 * this is only how they're entered, shown and left.
 */

/** What a Start Work chooser should offer first. */
export interface StartDefaults {
  projectId?: Id;
  taskId?: Id;
}

export interface ModeApi {
  ready: boolean;
  work: WorkSession | undefined;
  offTime: OffTimeSession | undefined;
  /** The focused Work Mode surface is showing (not just the compact bar). */
  focusOpen: boolean;
  setFocusOpen: (open: boolean) => void;
  /** Opens the Start Work chooser, offering `defaults` (or the current page's project) first. */
  openStartWork: (defaults?: StartDefaults) => void;
  /** Starts a session and enters Work Mode. Throws if it couldn't start. */
  startWork: (input: StartWork) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Finishes the session and shows its summary (with an optional note). */
  finish: () => Promise<void>;
  /** Enters Sleep Mode, or first asks what to do about running work. */
  requestSleep: () => void;
  wake: () => Promise<void>;
}

export const ModeContext = createContext<ModeApi | null>(null);

export function useModeApi(): ModeApi {
  const api = useContext(ModeContext);
  if (!api) throw new Error('useModeApi must be used inside the app shell');
  return api;
}

/** The shortcut that starts or returns to Work Mode (⌘/Ctrl ⇧ Enter). */
export const WORK_SHORTCUT = { key: 'Enter', shift: true, mod: true } as const;

/** "⌘⇧↵" on Apple devices, "Ctrl Shift Enter" elsewhere. */
export const workShortcutLabel = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘⇧↵'
    : 'Ctrl Shift Enter';
