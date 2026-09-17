import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, readOps, readSnapshot, wipeAll, write } from '../lib/db.ts'
import { makeCapsule, makeProject, makeThing } from '../lib/model.ts'
import { draftFromCapsule } from '../lib/model.ts'

beforeEach(async () => {
  await wipeAll()
})

describe('local storage', () => {
  it('keeps what was written and gives it back', async () => {
    const thing = makeThing('buy stamps')
    await write({ things: [thing] })

    const snapshot = await readSnapshot()
    expect(snapshot.things).toHaveLength(1)
    expect(snapshot.things[0].text).toBe('buy stamps')
  })

  it('survives the database being closed and reopened (a browser restart)', async () => {
    const project = makeProject('Harrow deck')
    const capsule = makeCapsule(project.id, {
      ...draftFromCapsule(null),
      nextAction: 'open slide 12',
    })
    await write({ projects: [project], capsules: [capsule] })

    closeDb()

    const snapshot = await readSnapshot()
    expect(snapshot.projects.map((p) => p.name)).toEqual(['Harrow deck'])
    expect(snapshot.capsules[0].nextAction).toBe('open slide 12')
  })

  it('replaces a record in place when it is written again', async () => {
    const thing = makeThing('draft the email')
    await write({ things: [thing] })
    await write({ things: [{ ...thing, kind: 'action', updatedAt: Date.now() }] })

    const snapshot = await readSnapshot()
    expect(snapshot.things).toHaveLength(1)
    expect(snapshot.things[0].kind).toBe('action')
  })

  it('records every write in the change log so sync can be added later', async () => {
    const a = makeThing('one')
    const b = makeThing('two')
    await write({ things: [a, b] })
    await write({ deletes: [{ store: 'things', id: a.id }] })

    const ops = await readOps()
    expect(ops.map((op) => op.type)).toEqual(['put', 'put', 'delete'])
    expect(ops.every((op) => op.entity === 'thing')).toBe(true)
    expect(ops.at(-1)?.id).toBe(a.id)
  })

  it('removes everything only when explicitly asked', async () => {
    await write({ things: [makeThing('a')], projects: [makeProject('p')] })
    await wipeAll()
    const snapshot = await readSnapshot()
    expect(snapshot.things).toHaveLength(0)
    expect(snapshot.projects).toHaveLength(0)
  })
})
