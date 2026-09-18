import { beforeEach, describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { DB_NAME, closeDb, readOps, readSnapshot, wipeAll, write } from '../lib/db.ts'
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

describe('schema migration', () => {
  it('carries a version 1 database forward without losing anything', async () => {
    // Start from a clean slate, then hand-build the database exactly as the
    // first milestone wrote it: version 1, and projects with no description.
    closeDb()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve()
    })

    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('things', { keyPath: 'id' }).createIndex('byCreated', 'createdAt')
        db.createObjectStore('projects', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt')
        const capsules = db.createObjectStore('capsules', { keyPath: 'id' })
        capsules.createIndex('byProject', 'projectId')
        capsules.createIndex('bySaved', 'savedAt')
        db.createObjectStore('handoffs', { keyPath: 'id' }).createIndex('byClosed', 'closedAt')
        db.createObjectStore('meta', { keyPath: 'key' })
        db.createObjectStore('oplog', { keyPath: 'seq', autoIncrement: true })
      },
    })
    const legacyThing = { ...makeThing('written under schema v1'), kind: 'idea' as const }
    const legacyProject = makeProject('Old project')
    // A v1 project record has no `description` field at all.
    const { description: _dropped, ...withoutDescription } = legacyProject
    await v1.put('things', legacyThing)
    await v1.put('projects', withoutDescription as never)
    await v1.put('capsules', makeCapsule(legacyProject.id, { ...draftFromCapsule(null), nextAction: 'carry on' }))
    v1.close()

    // Opening through the app's own code runs the v1 → v2 upgrade.
    const snapshot = await readSnapshot()

    expect(snapshot.things.map((t) => t.text)).toEqual(['written under schema v1'])
    expect(snapshot.things[0].kind).toBe('idea')
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0].name).toBe('Old project')
    // The field added in v2 is present and empty, never undefined.
    expect(snapshot.projects[0].description).toBe('')
    expect(snapshot.capsules[0].nextAction).toBe('carry on')

    // And the upgraded record is what is actually on disk now.
    const reopened = await readSnapshot()
    expect(reopened.projects[0].description).toBe('')
  })
})
