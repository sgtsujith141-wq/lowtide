import { useMemo } from 'react';
import { Link } from 'react-router';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { LocalDate } from '../../types/domain';
import { hackathonsForToday } from '../hackathons/schedule';
import { SectionHeading } from './SectionHeading';

/**
 * Near-term hackathons on Today (ADR-029): at most three, one row each, no
 * controls. Renders nothing when nothing is relevant.
 */
export function TodayHackathons({ today }: { today: LocalDate }) {
  const { hackathons } = useRepositories();
  const all = useWatch(hackathons.watchAll);
  const { rows, more } = useMemo(
    () => (all.status === 'ready' ? hackathonsForToday(all.data, today) : { rows: [], more: 0 }),
    [all, today],
  );
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="today-hackathons-heading" className="mt-7">
      <SectionHeading id="today-hackathons-heading">Hackathons</SectionHeading>
      <ul>
        {rows.map(({ hackathon, label }) => (
          <li key={hackathon.id} className="border-b border-line py-2">
            <Link to="/hackathons" className="font-medium break-words hover:underline">
              {hackathon.name}
            </Link>
            <p className="mt-0.5 text-sm text-ink-muted">
              {label}
              {hackathon.nextAction && (
                <>
                  {' · '}
                  <span className="text-ink">Next: {hackathon.nextAction}</span>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-1.5 text-xs">
          <Link to="/hackathons" className="text-accent-ink hover:underline">
            See all hackathons ({more} more coming up)
          </Link>
        </p>
      )}
    </section>
  );
}
