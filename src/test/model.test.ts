import { describe, expect, it } from 'vitest'
import {
  approaching,
  capsulesFor,
  classifyThing,
  draftFromCapsule,
  dueTickets,
  editThingText,
  isCapsuleEmpty,
  latestCapsule,
  latestHandoff,
  makeCapsule,
  makeHandoff,
  makeThing,
  overdue,
  parkedTickets,
  splitLines,
  unrouted,
} from '../lib/model.ts'
import { DAY_MS, fromDateInput, startOfDay, toDateInput } from '../lib/dates.ts'

describe('capture', () => {
  it('keeps the text exactly as written', () => {
    const text = '  call the dentist about the crown  '
    const thing = makeThing(text.trim())
    expect(thing.text).toBe('call the dentist about the crown')
    expect(thing.kind).toBeNull()
    expect(thing.originalText).toBeNull()
  })

  it('splits a pasted block into one thought per line, dropping blank lines', () => {
    expect(splitLines('one\n\n  two  \nthree\n')).toEqual(['one', 'two', 'three'])
  })

  it('preserves the first version of the text when it is edited', () => {
    const thing = makeThing('by fryday send teh numbers')
    const edited = editThingText(thing, 'by Friday send the numbers')
    expect(edited.text).toBe('by Friday send the numbers')
    expect(edited.originalText).toBe('by fryday send teh numbers')

    const again = editThingText(edited, 'send Priya the numbers by Friday')
    expect(again.originalText).toBe('by fryday send teh numbers')
  })

  it('returns the same object when an edit changes nothing', () => {
    const thing = makeThing('unchanged')
    expect(editThingText(thing, 'unchanged')).toBe(thing)
  })
})

describe('classification', () => {
  it('records the kind and stays editable afterwards', () => {
    const thing = makeThing('send Priya the numbers')
    const first = classifyThing(thing, { kind: 'commitment', dueAt: startOfDay() })
    expect(first.kind).toBe('commitment')
    expect(first.classifiedAt).not.toBeNull()

    const changed = classifyThing(first, { kind: 'action' })
    expect(changed.kind).toBe('action')
    // The original classification time is kept; the due date is not thrown away.
    expect(changed.classifiedAt).toBe(first.classifiedAt)
    expect(changed.dueAt).toBe(first.dueAt)
  })

  it('lists only unrouted, undeleted, open things as the queue', () => {
    const a = makeThing('unrouted')
    const b = classifyThing(makeThing('routed'), { kind: 'idea' })
    const c = { ...makeThing('deleted'), deletedAt: Date.now() }
    const d = { ...makeThing('finished'), status: 'done' as const }
    expect(unrouted([a, b, c, d]).map((t) => t.id)).toEqual([a.id])
  })
})

describe('commitments and return tickets', () => {
  const now = startOfDay(new Date(2026, 8, 17))

  it('surfaces approaching and overdue commitments, never hiding the past ones', () => {
    const late = classifyThing(makeThing('late'), { kind: 'commitment', dueAt: now - 2 * DAY_MS })
    const soon = classifyThing(makeThing('soon'), { kind: 'commitment', dueAt: now + 2 * DAY_MS })
    const far = classifyThing(makeThing('far'), { kind: 'commitment', dueAt: now + 30 * DAY_MS })
    const list = [far, soon, late]

    expect(approaching(list, 7, now).map((t) => t.text)).toEqual(['late', 'soon'])
    expect(overdue(list, now).map((t) => t.text)).toEqual(['late'])
  })

  it('surfaces a parked item only once its day has arrived', () => {
    const today = { ...makeThing('due today'), returnAt: now }
    const past = { ...makeThing('overdue ticket'), returnAt: now - 3 * DAY_MS }
    const future = { ...makeThing('later'), returnAt: now + 3 * DAY_MS }
    const cleared = { ...makeThing('cleared'), returnAt: now, returnedAt: now }
    const list = [today, past, future, cleared]

    expect(dueTickets(list, now).map((t) => t.text)).toEqual(['overdue ticket', 'due today'])
    expect(parkedTickets(list, now).map((t) => t.text)).toEqual(['later'])
  })

  it('round-trips a date through the date input format', () => {
    const value = toDateInput(now)
    expect(value).toBe('2026-09-17')
    expect(fromDateInput(value)).toBe(now)
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('not-a-date')).toBeNull()
  })
})

describe('black box capsules', () => {
  it('adds a version rather than replacing one, and keeps history', () => {
    const first = makeCapsule('p1', {
      status: 'drafting',
      lastCompleted: 'outline',
      blocker: '',
      lastDecision: 'cut the case study',
      nextAction: 'write slide 12',
      notes: '',
      links: [],
    }, 1_000)
    const second = makeCapsule('p1', {
      ...draftFromCapsule(first),
      nextAction: 'send it to Priya',
    }, 2_000)

    const all = [first, second]
    expect(latestCapsule(all, 'p1')?.id).toBe(second.id)
    expect(capsulesFor(all, 'p1')).toHaveLength(2)
    // The earlier capsule is untouched.
    expect(first.nextAction).toBe('write slide 12')
    expect(second.lastDecision).toBe('cut the case study')
  })

  it('treats a blank capsule as empty so it cannot be saved by accident', () => {
    expect(isCapsuleEmpty(draftFromCapsule(null))).toBe(true)
    expect(isCapsuleEmpty({ ...draftFromCapsule(null), nextAction: 'x' })).toBe(false)
  })

  it('drops link rows that are entirely blank', () => {
    const capsule = makeCapsule('p1', {
      ...draftFromCapsule(null),
      nextAction: 'go',
      links: [
        { id: 'l1', label: '', url: '' },
        { id: 'l2', label: 'Spec', url: 'https://example.invalid/spec' },
      ],
    })
    expect(capsule.links).toHaveLength(1)
    expect(capsule.links[0].label).toBe('Spec')
  })
})

describe('hand-off', () => {
  it('records what was chosen and what was left, without inventing anything', () => {
    const handoff = makeHandoff({
      nextActionIds: ['t1', 't2'],
      note: '  stopped mid-sentence  ',
      leftUnclassified: 4,
      savedProjectIds: ['p1'],
      dueSoonIds: ['t3'],
    })
    expect(handoff.note).toBe('stopped mid-sentence')
    expect(handoff.nextActionIds).toEqual(['t1', 't2'])
    expect(handoff.leftUnclassified).toBe(4)
  })

  it('returns the most recent hand-off', () => {
    const older = makeHandoff({ nextActionIds: [], note: 'a', leftUnclassified: 0, savedProjectIds: [], dueSoonIds: [] }, 1)
    const newer = makeHandoff({ nextActionIds: [], note: 'b', leftUnclassified: 0, savedProjectIds: [], dueSoonIds: [] }, 2)
    expect(latestHandoff([older, newer])?.note).toBe('b')
    expect(latestHandoff([])).toBeNull()
  })
})
