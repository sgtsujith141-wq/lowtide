import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, readSnapshot, wipeAll, write } from '../lib/db.ts'
import { buildExport, previewImport } from '../lib/transfer.ts'
import {
  approaching,
  classifyThing,
  draftFromCapsule,
  dueTickets,
  latestCapsule,
  latestHandoff,
  makeCapsule,
  makeHandoff,
  makeProject,
  makeThing,
  splitLines,
  unrouted,
} from '../lib/model.ts'
import { DAY_MS, startOfDay } from '../lib/dates.ts'

const MESSY_DUMP = `call the dentist about the crown
the Harrow deck is still unfinished
I said I would send Priya the numbers by Friday
book the car in some time

is the passport still valid?`

beforeEach(async () => {
  await wipeAll()
})

/**
 * The acceptance path, end to end, through the same storage layer the app uses:
 * dump → file → project → capsule → close → restart → return → export/restore.
 */
describe('a day in LOWTIDE', () => {
  it('carries a messy dump all the way to a resumable hand-off', async () => {
    const today = startOfDay()

    // 1. A messy brain dump, saved line by line.
    const captured = splitLines(MESSY_DUMP).map((text, i) => makeThing(text, 'batch-1', today + i))
    expect(captured).toHaveLength(5)
    await write({ things: captured })

    // 2. File some of them; leave the rest unfiled on purpose.
    const dentist = classifyThing(captured[0], { kind: 'action' })
    const priya = classifyThing(captured[2], { kind: 'commitment', dueAt: today + 2 * DAY_MS })
    const passport = { ...classifyThing(captured[4], { kind: 'onmymind' }), returnAt: today }
    await write({ things: [dentist, priya, passport] })

    // 3. Create a project and 4. save its place.
    const project = makeProject('Harrow deck')
    const capsuleV1 = makeCapsule(
      project.id,
      {
        ...draftFromCapsule(null),
        status: 'Second draft, client has seen nothing',
        lastCompleted: 'Rewrote the opening',
        blocker: 'Waiting on revised figures',
        lastDecision: 'Dropped the case study rather than shorten it',
        nextAction: 'Open slide 12 and write the three-line summary',
      },
      today + 100,
    )
    await write({ projects: [project], capsules: [capsuleV1] })

    // The Harrow thought belongs to that project.
    const deck = { ...classifyThing(captured[1], { kind: 'project' }), projectId: project.id }
    await write({ things: [deck] })

    // 5. Close the day, choosing a small number of next actions.
    const stillUnfiled = unrouted([dentist, priya, passport, deck, captured[3]]).length
    expect(stillUnfiled).toBe(1)
    const handoff = makeHandoff(
      {
        nextActionIds: [dentist.id, priya.id],
        note: 'Stopped halfway through slide 12. Figures still not in.',
        leftUnclassified: stillUnfiled,
        savedProjectIds: [project.id],
        dueSoonIds: [priya.id],
      },
      today + 200,
    )
    await write({ handoffs: [handoff] })

    // 6. Restart the browser.
    closeDb()

    // 7. Return, and resume from what was saved.
    const snapshot = await readSnapshot()
    const last = latestHandoff(snapshot.handoffs)
    expect(last?.note).toContain('Stopped halfway through slide 12')

    const chosen = last!.nextActionIds.map(
      (id) => snapshot.things.find((t) => t.id === id)?.text,
    )
    expect(chosen).toEqual([
      'call the dentist about the crown',
      'I said I would send Priya the numbers by Friday',
    ])

    expect(approaching(snapshot.things, 7, today).map((t) => t.id)).toEqual([priya.id])
    expect(dueTickets(snapshot.things, today).map((t) => t.id)).toEqual([passport.id])
    expect(unrouted(snapshot.things)).toHaveLength(1)

    const saved = latestCapsule(snapshot.capsules, project.id)
    expect(saved?.nextAction).toBe('Open slide 12 and write the three-line summary')
    expect(saved?.blocker).toBe('Waiting on revised figures')

    // Updating the capsule keeps the earlier one.
    const capsuleV2 = makeCapsule(
      project.id,
      { ...draftFromCapsule(saved), nextAction: 'Send the deck to Priya' },
      today + 300,
    )
    await write({ capsules: [capsuleV2] })
    const afterUpdate = await readSnapshot()
    expect(afterUpdate.capsules).toHaveLength(2)
    expect(latestCapsule(afterUpdate.capsules, project.id)?.nextAction).toBe('Send the deck to Priya')
    expect(afterUpdate.capsules.find((c) => c.id === capsuleV1.id)?.nextAction).toBe(
      'Open slide 12 and write the three-line summary',
    )

    // 8. Export, wipe the device, and restore.
    const backup = JSON.stringify(buildExport(afterUpdate))
    await wipeAll()
    expect((await readSnapshot()).things).toHaveLength(0)

    const preview = previewImport(backup, await readSnapshot())
    expect(preview.ok).toBe(true)
    expect(preview.counts.things).toBe(5)
    expect(preview.counts.capsules).toBe(2)
    await write(preview.incoming)

    const restored = await readSnapshot()
    expect(restored.things).toHaveLength(5)
    expect(latestHandoff(restored.handoffs)?.note).toBe(
      'Stopped halfway through slide 12. Figures still not in.',
    )
    expect(latestCapsule(restored.capsules, project.id)?.nextAction).toBe('Send the deck to Priya')
  })

  it('leaves unfinished work exactly as it was when the day is closed', async () => {
    const thing = makeThing('half-written thing')
    await write({ things: [thing] })
    await write({
      handoffs: [
        makeHandoff({
          nextActionIds: [],
          note: '',
          leftUnclassified: 1,
          savedProjectIds: [],
          dueSoonIds: [],
        }),
      ],
    })

    const snapshot = await readSnapshot()
    expect(snapshot.things[0]).toEqual(thing)
    expect(latestHandoff(snapshot.handoffs)?.leftUnclassified).toBe(1)
  })
})
