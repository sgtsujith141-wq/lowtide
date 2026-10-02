import {
  Bot,
  CalendarDays,
  ChevronRight,
  Database,
  HeartPulse,
  Inbox,
  Library,
  ListTodo,
  Settings,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { useCompanion } from '../../hooks/useCompanion';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { AiChangesBadge } from '../context/AiChanges';
import { ModeActions } from '../modes/ModeActions';

const MORE_LINKS: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: '/space', label: 'SPACE', hint: 'Project knowledge and documents', icon: Library },
  { to: '/today', label: 'Today', hint: 'Plan, deadlines, capture', icon: Sun },
  { to: '/inbox', label: 'Inbox', hint: 'Sort captured thoughts', icon: Inbox },
  { to: '/tasks', label: 'Tasks', hint: 'Everything open', icon: ListTodo },
  { to: '/life', label: 'Life', hint: 'Routines, sleep, gym, college', icon: HeartPulse },
  { to: '/calendar', label: 'Calendar', hint: 'Everything by date', icon: CalendarDays },
  { to: '/ai', label: 'AI & workspace', hint: 'Which AI tools can see what', icon: Bot },
  { to: '/data', label: 'Data & backup', hint: 'Export, restore, storage', icon: Database },
  { to: '/settings', label: 'Settings', hint: 'Appearance, privacy', icon: Settings },
];

/** Phones: the secondary destinations behind the fifth tab (ADR-043). */
export function MorePage() {
  useDocumentTitle('More');
  const { client } = useCompanion();
  return (
    <>
      <h1 className="text-page font-semibold">More</h1>
      <div className="mt-4">
        <ModeActions />
      </div>
      <nav aria-label="More" className="mt-6">
        <ul className="divide-y divide-line border-y border-line">
          {MORE_LINKS.map(({ to, label, hint, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex items-center gap-3 px-1 py-3 transition-colors hover:bg-hover"
              >
                <Icon aria-hidden className="size-5 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-fg-muted">{hint}</span>
                </span>
                {to === '/ai' && <AiChangesBadge client={client} />}
                <ChevronRight aria-hidden className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
