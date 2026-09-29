import {
  CalendarDays,
  ChevronRight,
  Database,
  HeartPulse,
  Inbox,
  ListTodo,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { ModeActions } from '../modes/ModeActions';

const MORE_LINKS: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: '/today', label: 'Today', hint: 'Plan, deadlines, capture', icon: Sun },
  { to: '/inbox', label: 'Inbox', hint: 'Sort captured thoughts', icon: Inbox },
  { to: '/tasks', label: 'Tasks', hint: 'Everything open', icon: ListTodo },
  { to: '/life', label: 'Life', hint: 'Routines, sleep, gym, college', icon: HeartPulse },
  { to: '/calendar', label: 'Calendar', hint: 'Everything by date', icon: CalendarDays },
  { to: '/data', label: 'Data & backup', hint: 'Export, restore, storage', icon: Database },
];

/** Phones: the secondary destinations behind the fifth tab (ADR-043). */
export function MorePage() {
  useDocumentTitle('More');
  return (
    <>
      <h1 className="font-serif text-xl font-semibold tracking-tight">More</h1>
      <div className="mt-4">
        <ModeActions />
      </div>
      <nav aria-label="More" className="mt-6">
        <ul className="divide-y divide-line rounded-xl border border-line bg-paper-raised">
          {MORE_LINKS.map(({ to, label, hint, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                <Icon aria-hidden className="size-5 text-ink-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-ink-muted">{hint}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 text-ink-faint" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
