import type { TimelineEntry } from '../../db/repositories';
import { formatDuration } from '../../lib/duration';
import type { EventType, WorkSession } from '../../types/domain';
import { activeMinutes } from '../work/duration';
import { concise } from './display';

/*
 * Which ledger events mean a project moved, and how each reads in one line
 * (v2 PHASE 013). Pure.
 */

const MEANINGFUL: ReadonlySet<EventType> = new Set([
  'work.finished',
  'task.completed',
  'milestone.completed',
  'project.updated',
  'project.approval_requested',
  'project.item_parked',
  'decision.recorded',
  'ai.session.completed',
  'note.created',
]);

const WHAT: Partial<Record<EventType, string>> = {
  'task.completed': 'Completed',
  'milestone.completed': 'Milestone reached',
  'project.approval_requested': 'Asked for approval',
  'project.item_parked': 'Parked',
  'decision.recorded': 'Decision',
  'note.created': 'Note',
  'ai.session.completed': 'Session',
};

export interface ActivityLine {
  entry: TimelineEntry;
  who: string;
  text: string;
}

/** One line per meaningful event: who, and what in a few words; null for noise. */
export function activityLine(
  entry: TimelineEntry,
  projectName: string,
  sessions: ReadonlyMap<string, WorkSession>,
): ActivityLine | null {
  const { event, title } = entry;
  if (!MEANINGFUL.has(event.type)) return null;
  const who =
    event.source === 'ai-client'
      ? (event.actor ?? 'AI client')
      : event.type === 'decision.recorded'
        ? 'Decision'
        : 'You';
  const short = (t: string | undefined) => (t ? concise(t, projectName, 72).text : '');
  let text: string;
  switch (event.type) {
    case 'work.finished': {
      const session = sessions.get(event.entityId);
      text = session ? `Worked ${formatDuration(Math.round(activeMinutes(session)))}` : 'Worked';
      break;
    }
    case 'project.updated':
      text =
        event.data.change === 'created'
          ? 'Project created'
          : event.data.change === 'state'
            ? `State: ${event.data.from?.replace('_', ' ')} → ${event.data.to?.replace('_', ' ')}`
            : 'Details updated';
      break;
    case 'decision.recorded':
      text = short(title) || 'Recorded';
      break;
    default:
      text = [WHAT[event.type], short(title)].filter(Boolean).join(': ');
  }
  return { entry, who, text };
}
