import { useState } from 'react'
import type { Project, Thing, ThingKind } from '../lib/types.ts'
import { KINDS } from '../lib/taxonomy.ts'
import { DAY_MS, fromDateInput, startOfDay, toDateInput } from '../lib/dates.ts'
import { Field } from './ui.tsx'
import { nowMs } from '../lib/clock.ts'

/**
 * The editable detail panel for one thing. Every classification and every
 * field here can be changed again later; nothing is one-way.
 */
export function ThingDetails({
  thing,
  projects,
  onPatch,
}: {
  thing: Thing
  projects: Project[]
  onPatch: (next: Thing) => Promise<void> | void
}) {
  const [note, setNote] = useState(thing.note)
  const [waitingOn, setWaitingOn] = useState(thing.waitingOn)

  const patch = (changes: Partial<Thing>) =>
    onPatch({ ...thing, ...changes, updatedAt: nowMs() })

  const setKind = (kind: ThingKind) =>
    patch({ kind, classifiedAt: thing.classifiedAt ?? nowMs() })

  const liveProjects = projects.filter((p) => p.deletedAt == null && p.archivedAt == null)

  return (
    <div className="mt-4 grid gap-4 border-t border-rule pt-4">
      <fieldset>
        <legend className="lt-label">Filed as</legend>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((meta) => {
            const active = thing.kind === meta.kind
            return (
              <button
                key={meta.kind}
                type="button"
                aria-pressed={active}
                className={`lt-btn px-2.5 py-1 text-xs ${
                  active ? 'lt-btn-primary' : 'lt-btn-secondary'
                }`}
                onClick={() => void setKind(meta.kind)}
              >
                {meta.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {thing.kind === 'commitment' ? (
        <Field
          label="Due"
          htmlFor={`due-${thing.id}`}
          hint="Dates are never hidden: anything due soon or past is shown on Return and at closing time."
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`due-${thing.id}`}
              type="date"
              className="lt-field w-auto"
              value={toDateInput(thing.dueAt)}
              onChange={(e) => void patch({ dueAt: fromDateInput(e.target.value) })}
            />
            <button
              type="button"
              className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
              onClick={() => void patch({ dueAt: startOfDay() })}
            >
              Today
            </button>
            <button
              type="button"
              className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
              onClick={() => void patch({ dueAt: startOfDay() + DAY_MS })}
            >
              Tomorrow
            </button>
            {thing.dueAt != null ? (
              <button
                type="button"
                className="lt-btn lt-btn-quiet text-xs"
                onClick={() => void patch({ dueAt: null })}
              >
                Clear
              </button>
            ) : null}
          </div>
        </Field>
      ) : null}

      {thing.kind === 'waiting' ? (
        <Field label="Waiting on" htmlFor={`waiting-${thing.id}`}>
          <input
            id={`waiting-${thing.id}`}
            type="text"
            className="lt-field"
            placeholder="Who has it?"
            value={waitingOn}
            onChange={(e) => setWaitingOn(e.target.value)}
            onBlur={() => {
              if (waitingOn !== thing.waitingOn) void patch({ waitingOn })
            }}
          />
        </Field>
      ) : null}

      {liveProjects.length > 0 ? (
        <Field label="Part of" htmlFor={`project-${thing.id}`}>
          <select
            id={`project-${thing.id}`}
            className="lt-field"
            value={thing.projectId ?? ''}
            onChange={(e) => void patch({ projectId: e.target.value || null })}
          >
            <option value="">Nothing in particular</option>
            {liveProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field
        label="Return ticket"
        htmlFor={`return-${thing.id}`}
        hint="Park it until a day you choose. LOWTIDE has no background notifications — it can only bring this back when you open the app on or after that day."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`return-${thing.id}`}
            type="date"
            className="lt-field w-auto"
            value={toDateInput(thing.returnAt)}
            onChange={(e) =>
              void patch({ returnAt: fromDateInput(e.target.value), returnedAt: null })
            }
          />
          <button
            type="button"
            className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
            onClick={() => void patch({ returnAt: startOfDay() + 7 * DAY_MS, returnedAt: null })}
          >
            In a week
          </button>
          {thing.returnAt != null ? (
            <button
              type="button"
              className="lt-btn lt-btn-quiet text-xs"
              onClick={() => void patch({ returnAt: null, returnedAt: null })}
            >
              Clear
            </button>
          ) : null}
        </div>
      </Field>

      <Field label="Anything else worth keeping" htmlFor={`note-${thing.id}`}>
        <textarea
          id={`note-${thing.id}`}
          className="lt-field min-h-16"
          placeholder="Context you would otherwise have to rebuild."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== thing.note) void patch({ note })
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        {thing.status === 'open' ? (
          <button
            type="button"
            className="lt-btn lt-btn-secondary text-xs"
            onClick={() => void patch({ status: 'done', completedAt: nowMs() })}
          >
            Mark done
          </button>
        ) : (
          <button
            type="button"
            className="lt-btn lt-btn-secondary text-xs"
            onClick={() => void patch({ status: 'open', completedAt: null })}
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  )
}
