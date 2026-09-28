import type { BackupCounts } from '../../db/repositories';

export const COUNT_ROWS: { key: keyof BackupCounts; label: string }[] = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'inbox', label: 'Inbox items' },
  { key: 'habits', label: 'Rhythms' },
  { key: 'habitEntries', label: 'Activity entries' },
  { key: 'hackathons', label: 'Hackathons' },
  { key: 'protectedTime', label: 'Protected time' },
];
