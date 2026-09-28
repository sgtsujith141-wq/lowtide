import { Pencil } from 'lucide-react';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { fieldClass } from '../../components/ui/styles';
import {
  BUILD_STATUSES,
  HACKATHON_STATUSES,
  PPT_STATUSES,
  REGISTRATION_STATUSES,
  type Hackathon,
  type LocalDate,
} from '../../types/domain';
import { BUILD_LABEL, PPT_LABEL, REGISTRATION_LABEL, STATUS_LABEL } from './labels';
import { formatRange, primaryMoment, type MomentTone } from './schedule';

const TONE_CLASS: Record<MomentTone, string> = {
  past: 'text-ink-muted',
  now: 'text-accent-ink font-medium',
  today: 'text-accent-ink font-medium',
  soon: 'text-ink',
  later: 'text-ink-muted',
};

type StatusField = 'status' | 'registrationStatus' | 'pptStatus' | 'buildStatus';

const QUICK_STATUS: {
  field: StatusField;
  label: string;
  values: readonly string[];
  labels: Record<string, string>;
}[] = [
  {
    field: 'registrationStatus',
    label: 'Registration',
    values: REGISTRATION_STATUSES,
    labels: REGISTRATION_LABEL,
  },
  { field: 'pptStatus', label: 'PPT', values: PPT_STATUSES, labels: PPT_LABEL },
  { field: 'buildStatus', label: 'Build', values: BUILD_STATUSES, labels: BUILD_LABEL },
  { field: 'status', label: 'Status', values: HACKATHON_STATUSES, labels: STATUS_LABEL },
];

/**
 * One hackathon as a compact project sheet: name, where it stands in time,
 * the next action (editable in place), text-first status selects that save
 * on change, and a disclosure for the problem statement, team and notes.
 */
export function HackathonSheet({
  hackathon: h,
  today,
  busy,
  onStatus,
  onNextAction,
  onEdit,
}: {
  hackathon: Hackathon;
  today: LocalDate;
  busy: boolean;
  onStatus: (field: StatusField, value: string) => void;
  onNextAction: (value: string) => Promise<boolean>;
  onEdit: () => void;
}) {
  const id = useId();
  const moment = primaryMoment(h, today);
  const range = h.eventStart ? formatRange(h.eventStart, h.eventEnd, today) : null;
  const [editingNext, setEditingNext] = useState(false);
  const [next, setNext] = useState(h.nextAction ?? '');
  const hasDetails = Boolean(h.problemStatement || h.team || h.notes);

  async function saveNext(event: FormEvent) {
    event.preventDefault();
    if (await onNextAction(next)) setEditingNext(false);
  }

  return (
    <article
      aria-labelledby={`${id}-name`}
      className="border-b border-line py-3"
      aria-busy={busy || undefined}
    >
      <div className="flex items-start gap-2">
        <h3 id={`${id}-name`} className="min-w-0 flex-1 font-medium break-words">
          {h.name}
        </h3>
        <IconButton
          label={`Edit ${h.name}`}
          icon={<Pencil aria-hidden className="size-4" />}
          data-hackathon-edit={h.id}
          onClick={onEdit}
          className="-my-1"
        />
      </div>

      {(moment || range) && (
        <p className="mt-0.5 text-sm">
          {moment && <span className={TONE_CLASS[moment.tone]}>{moment.text}</span>}
          {moment && range && <span className="text-ink-faint"> · </span>}
          {range && <span className="text-ink-muted">{range}</span>}
        </p>
      )}

      <div className="mt-1.5">
        {editingNext ? (
          <form
            onSubmit={saveNext}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setNext(h.nextAction ?? '');
                setEditingNext(false);
              }
            }}
            className="flex gap-2"
          >
            <label htmlFor={`${id}-next`} className="sr-only">
              Next action for {h.name}
            </label>
            <input
              id={`${id}-next`}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoFocus
              autoComplete="off"
              placeholder="Finish PPT outline"
              className={`${fieldClass} py-1 text-sm`}
            />
            <Button type="submit" variant="primary" className="h-[30px]">
              Save
            </Button>
          </form>
        ) : h.nextAction ? (
          <p className="flex items-start gap-1.5 text-sm">
            <span className="shrink-0 font-medium text-accent-ink">Next:</span>
            <span className="min-w-0 flex-1 break-words">{h.nextAction}</span>
            <IconButton
              label={`Edit next action for ${h.name}`}
              icon={<Pencil aria-hidden className="size-3.5" />}
              onClick={() => {
                setNext(h.nextAction ?? '');
                setEditingNext(true);
              }}
              className="-my-1.5 size-7"
            />
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setEditingNext(true)}
            aria-label={`Add a next action for ${h.name}`}
            className="text-sm text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            Add a next action
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
        {QUICK_STATUS.map(({ field, label, values, labels }) => (
          <label key={field} className="inline-flex items-center gap-1">
            <span>{label}</span>
            <select
              value={h[field]}
              aria-label={`${label} for ${h.name}`}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onStatus(field, e.target.value)}
              className="rounded-sm bg-transparent py-0.5 pr-0.5 text-xs font-medium text-ink hover:bg-paper-sunken"
            >
              {values.map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {hasDetails && (
        <details className="mt-1.5 text-sm">
          <summary className="cursor-pointer text-xs text-ink-muted select-none hover:text-ink">
            {[h.problemStatement && 'Problem statement', h.team && 'Team', h.notes && 'Notes']
              .filter(Boolean)
              .join(', ')}
          </summary>
          <dl className="mt-1 grid gap-1.5 border-l-2 border-line pl-3">
            {h.problemStatement && (
              <div>
                <dt className="text-xs text-ink-muted">Problem statement</dt>
                <dd className="break-words whitespace-pre-wrap">{h.problemStatement}</dd>
              </div>
            )}
            {h.team && (
              <div>
                <dt className="text-xs text-ink-muted">Team</dt>
                <dd className="break-words">{h.team}</dd>
              </div>
            )}
            {h.notes && (
              <div>
                <dt className="text-xs text-ink-muted">Notes</dt>
                <dd className="break-words whitespace-pre-wrap">{h.notes}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
    </article>
  );
}
