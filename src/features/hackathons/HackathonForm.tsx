import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import type { HackathonChanges } from '../../db/repositories';
import {
  BUILD_STATUSES,
  HACKATHON_KINDS,
  HACKATHON_SELECTIONS,
  HACKATHON_STATUSES,
  PPT_STATUSES,
  REGISTRATION_STATUSES,
  RESEARCH_STATUSES,
  type Hackathon,
} from '../../types/domain';
import {
  BUILD_LABEL,
  KIND_LABEL,
  PPT_LABEL,
  REGISTRATION_LABEL,
  RESEARCH_LABEL,
  SELECTION_LABEL,
  STATUS_LABEL,
} from './labels';

type Draft = Required<{ [K in Exclude<keyof HackathonChanges, 'projectId'>]: string }>;

function toDraft(h: Partial<Hackathon>): Draft {
  return {
    name: h.name ?? '',
    status: h.status ?? 'considering',
    registrationStatus: h.registrationStatus ?? 'not_registered',
    pptStatus: h.pptStatus ?? 'not_started',
    researchStatus: h.researchStatus ?? 'not_started',
    buildStatus: h.buildStatus ?? 'not_started',
    kind: h.kind ?? 'hackathon',
    selection: h.selection ?? '',
    registrationDeadline: h.registrationDeadline ?? '',
    eventStart: h.eventStart ?? '',
    eventEnd: h.eventEnd ?? '',
    team: h.team ?? '',
    problemStatement: h.problemStatement ?? '',
    nextAction: h.nextAction ?? '',
    notes: h.notes ?? '',
  };
}

/**
 * Add or edit a hackathon. `quick` shows only name and event dates, so a new
 * hackathon takes seconds; everything else is filled in later via Edit.
 * Blank optional fields are sent as '' and cleared by the repository.
 */
export function HackathonForm({
  initial,
  quick,
  formLabel,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial: Partial<Hackathon>;
  quick: boolean;
  formLabel: string;
  submitLabel: string;
  onSave: (changes: HackathonChanges & { name: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [error, setError] = useState<{ field: 'name' | 'eventEnd' | 'form'; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const id = useId();
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft({ ...draft, [key]: e.target.value });
    setError(null);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return setError({ field: 'name', text: 'Give it a name.' });
    if (draft.eventEnd && !draft.eventStart) {
      return setError({
        field: 'eventEnd',
        text: 'Add a start date for the end date to make sense.',
      });
    }
    if (draft.eventEnd && draft.eventEnd < draft.eventStart) {
      return setError({ field: 'eventEnd', text: 'The event can’t end before it starts.' });
    }
    setSaving(true);
    try {
      await onSave(draft as HackathonChanges & { name: string });
    } catch {
      setError({ field: 'form', text: 'Couldn’t save that. It’s still here.' });
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  const described = (field: 'name' | 'eventEnd') =>
    error?.field === field ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};
  const input = (key: keyof Draft, label: string, extra: object = {}) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={draft[key]}
        onChange={set(key)}
        autoComplete="off"
        className={`${fieldClass} text-sm`}
        {...extra}
      />
    </div>
  );
  const select = (
    key: keyof Draft,
    label: string,
    values: readonly string[],
    labels: Record<string, string>,
  ) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={labelClass}>
        {label}
      </label>
      <select
        id={`${id}-${key}`}
        value={draft[key]}
        onChange={set(key)}
        className={`${fieldClass} text-sm`}
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={formLabel}
      className="my-2 grid gap-3 rounded-md bg-surface p-2"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_9rem]">
        {input('name', 'Name', {
          autoFocus: true,
          placeholder: 'Hackurity, AI Build Week…',
          ...described('name'),
        })}
        {input('eventStart', 'Event starts', { type: 'date' })}
        {input('eventEnd', 'Event ends (optional)', { type: 'date', ...described('eventEnd') })}
      </div>

      {!quick && (
        <>
          <fieldset className="grid gap-3 sm:grid-cols-5">
            <legend className="sr-only">Registration and progress</legend>
            {input('registrationDeadline', 'Registration deadline', { type: 'date' })}
            {select(
              'registrationStatus',
              'Registration',
              REGISTRATION_STATUSES,
              REGISTRATION_LABEL,
            )}
            {select('researchStatus', 'Research', RESEARCH_STATUSES, RESEARCH_LABEL)}
            {select('pptStatus', 'PPT', PPT_STATUSES, PPT_LABEL)}
            {select('buildStatus', 'Build', BUILD_STATUSES, BUILD_LABEL)}
          </fieldset>
          {input('nextAction', 'Next action', { placeholder: 'Finish PPT outline' })}
          <div>
            <label htmlFor={`${id}-problemStatement`} className={labelClass}>
              Problem statement
            </label>
            <textarea
              id={`${id}-problemStatement`}
              value={draft.problemStatement}
              onChange={set('problemStatement')}
              rows={2}
              className={`${fieldClass} resize-y text-sm`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem_12rem]">
            {input('team', 'Team')}
            {select('kind', 'Kind', HACKATHON_KINDS, KIND_LABEL)}
            {select('status', 'Status', HACKATHON_STATUSES, STATUS_LABEL)}
            {select('selection', 'Selection', ['', ...HACKATHON_SELECTIONS], SELECTION_LABEL)}
          </div>
          <div>
            <label htmlFor={`${id}-notes`} className={labelClass}>
              Notes
            </label>
            <textarea
              id={`${id}-notes`}
              value={draft.notes}
              onChange={set('notes')}
              rows={2}
              placeholder="Exact times, links, anything else"
              className={`${fieldClass} resize-y text-sm`}
            />
          </div>
        </>
      )}

      {error && <ErrorNotice id={`${id}-error`}>{error.text}</ErrorNotice>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
