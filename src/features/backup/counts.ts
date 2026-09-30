import type { BackupCounts } from '../../db/repositories';

export const COUNT_ROWS: { key: keyof BackupCounts; label: string }[] = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'inbox', label: 'Inbox items' },
  { key: 'habits', label: 'Rhythms' },
  { key: 'habitEntries', label: 'Activity entries' },
  { key: 'hackathons', label: 'Hackathons' },
  { key: 'protectedTime', label: 'Protected time' },
  { key: 'projects', label: 'Projects' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'projectItems', label: 'Project items' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'workSessions', label: 'Work sessions' },
  { key: 'offTimeSessions', label: 'Off time' },
  { key: 'events', label: 'Timeline events' },
  { key: 'progressSnapshots', label: 'Progress snapshots' },
  { key: 'aiSessions', label: 'AI sessions' },
  { key: 'collegeItems', label: 'College items' },
  { key: 'notes', label: 'Notes' },
  { key: 'spaceNodes', label: 'SPACE pages' },
  { key: 'sourceRecords', label: 'Source records' },
];
