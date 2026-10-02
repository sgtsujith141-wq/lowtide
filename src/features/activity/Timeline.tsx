import {
  Bot,
  CheckCircle2,
  Flag,
  FolderKanban,
  Hand,
  Moon,
  ParkingSquare,
  Pause,
  Play,
  Scale,
  Sparkles,
  Square,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type { TimelineEntry } from '../../db/repositories';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { formatFull, formatWhen } from '../../lib/when';
import type { EventType } from '../../types/domain';

const EVENT: Record<EventType, { icon: LucideIcon; text: string }> = {
  'work.started': { icon: Play, text: 'Started work' },
  'work.paused': { icon: Pause, text: 'Paused work' },
  'work.resumed': { icon: Play, text: 'Resumed work' },
  'work.finished': { icon: Square, text: 'Finished a work session' },
  'offtime.started': { icon: Moon, text: 'Off time began' },
  'offtime.ended': { icon: Moon, text: 'Off time ended' },
  'habit.logged': { icon: Sparkles, text: 'Logged a routine' },
  'task.completed': { icon: CheckCircle2, text: 'Completed' },
  'milestone.completed': { icon: Flag, text: 'Milestone reached' },
  'project.updated': { icon: FolderKanban, text: 'Project updated' },
  'project.approval_requested': { icon: Hand, text: 'Approval requested' },
  'project.item_parked': { icon: ParkingSquare, text: 'Parked' },
  'decision.recorded': { icon: Scale, text: 'Decision recorded' },
  'ai.session.completed': { icon: Bot, text: 'AI session' },
  'note.created': { icon: StickyNote, text: 'Note added' },
};

function sentence({ event, title }: TimelineEntry): string {
  if (event.type === 'project.updated') {
    if (event.data.change === 'created') return 'Project created';
    if (event.data.change === 'state')
      return `State: ${event.data.from?.replace('_', ' ')} → ${event.data.to?.replace('_', ' ')}`;
    return 'Details updated';
  }
  const base = EVENT[event.type].text;
  return title ? `${base}: ${title}` : base;
}

/**
 * Recent activity as a quiet vertical timeline, from the ledger. Private
 * events (off time, routine logs) are left out. Titles come from the current
 * records; a deleted record reads as the bare event.
 */
export function Timeline({
  projectId,
  day,
  limit = 8,
  showProject = true,
  clamp = false,
  emptyText = 'Nothing has happened here yet. Activity appears as you work.',
}: {
  /** Long entries cut to two lines (Home). */
  clamp?: boolean;
  projectId?: string;
  /** Only that local day's events. */
  day?: string;
  limit?: number;
  showProject?: boolean;
  /** Shown when there's nothing; `null` renders nothing at all. */
  emptyText?: string | null;
}) {
  const { events } = useRepositories();
  const watch = useMemo(
    () =>
      events.watchTimeline({
        limit,
        ...(projectId ? { projectId } : {}),
        ...(day ? { day } : {}),
      }),
    [events, limit, projectId, day],
  );
  const entries = useWatch(watch);
  const now = new Date();
  if (entries.status !== 'ready') return null;
  if (entries.data.length === 0)
    return emptyText === null ? null : <p className="py-2 text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ol className="relative ml-2 border-l border-line">
      {entries.data.map((entry) => {
        const Icon = EVENT[entry.event.type].icon;
        return (
          <li key={entry.event.id} className="relative pb-3 pl-5 last:pb-0">
            <span className="absolute top-0.5 -left-[9px] grid size-[18px] place-items-center rounded-full border border-line bg-raised">
              <Icon aria-hidden className="size-2.5 text-fg-muted" />
            </span>
            <p className={`text-sm leading-snug ${clamp ? 'line-clamp-2' : ''}`}>
              {sentence(entry)}
              {entry.event.source === 'ai-client' && (
                <span className="ml-1 text-xs text-fg-muted">
                  (by {entry.event.actor ?? 'an AI client'})
                </span>
              )}
            </p>
            <p className="text-xs text-fg-muted">
              <time dateTime={entry.event.at} title={formatFull(entry.event.at)}>
                {formatWhen(entry.event.at, now)}
              </time>
              {showProject && entry.projectName && entry.event.projectId && (
                <> · {entry.projectName}</>
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
