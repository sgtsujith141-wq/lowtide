import { describe, expect, it } from 'vitest'
import { buildExport, previewImport } from '../lib/transfer.ts'
import { classifyThing, draftFromCapsule, makeCapsule, makeHandoff, makeProject, makeThing } from '../lib/model.ts'
import type { Snapshot } from '../lib/types.ts'

const EMPTY: Snapshot = { things: [], projects: [], capsules: [], handoffs: [] }

function sampleSnapshot(): Snapshot {
  const project = makeProject('Harrow deck')
  return {
    things: [
      classifyThing(makeThing('send Priya the numbers'), { kind: 'commitment', dueAt: 1_700_000_000_000 }),
      makeThing('unfiled thought'),
    ],
    projects: [project],
    capsules: [makeCapsule(project.id, { ...draftFromCapsule(null), nextAction: 'write slide 12' })],
    handoffs: [
      makeHandoff({ nextActionIds: [], note: 'stopped mid-sentence', leftUnclassified: 1, savedProjectIds: [], dueSoonIds: [] }),
    ],
  }
}

describe('export and import', () => {
  it('round-trips a full backup', () => {
    const snapshot = sampleSnapshot()
    const file = JSON.stringify(buildExport(snapshot))
    const preview = previewImport(file, EMPTY)

    expect(preview.ok).toBe(true)
    expect(preview.format).toBe('lowtide-v2')
    expect(preview.counts).toEqual({ things: 2, projects: 1, capsules: 1, handoffs: 1 })
    expect(preview.problems).toEqual([])
    expect(preview.incoming.things[0].text).toBe('send Priya the numbers')
    expect(preview.incoming.capsules[0].nextAction).toBe('write slide 12')
  })

  it('never offers to overwrite records that are already stored', () => {
    const snapshot = sampleSnapshot()
    const file = JSON.stringify(buildExport(snapshot))
    const preview = previewImport(file, snapshot)

    expect(preview.counts).toEqual({ things: 0, projects: 0, capsules: 0, handoffs: 0 })
    expect(preview.duplicates).toBe(5)
    expect(preview.ok).toBe(false)
  })

  it('reads a v1 prototype backup stored under the lowtide.v1 key', () => {
    const legacy = JSON.stringify({
      'lowtide.v1': {
        items: [
          { id: 'old-1', body: 'call the dentist', bucket: 'task', created: 1_600_000_000_000 },
          { id: 'old-2', body: 'the deck is unfinished', bucket: 'project' },
          { id: 'old-3', body: 'chase the invoice', bucket: 'waiting-for', who: 'Sam' },
        ],
        projects: [{ id: 'old-p', title: 'Kitchen rewire' }],
      },
    })

    const preview = previewImport(legacy, EMPTY)
    expect(preview.format).toBe('lowtide-v1')
    expect(preview.counts.things).toBe(3)
    expect(preview.counts.projects).toBe(1)
    expect(preview.incoming.things.map((t) => t.kind)).toEqual(['action', 'project', 'waiting'])
    expect(preview.incoming.things[2].waitingOn).toBe('Sam')
    expect(preview.incoming.projects[0].name).toBe('Kitchen rewire')
  })

  it('recovers from damaged records instead of failing the whole import', () => {
    const messy = JSON.stringify({
      version: 1,
      items: [
        null,
        { body: '' },
        { body: 'this one is fine', bucket: 'nonsense-bucket' },
        'not an object',
      ],
    })

    const preview = previewImport(messy, EMPTY)
    expect(preview.counts.things).toBe(1)
    expect(preview.incoming.things[0].text).toBe('this one is fine')
    // The unknown category is kept as unrouted rather than guessed at.
    expect(preview.incoming.things[0].kind).toBeNull()
    expect(preview.problems.length).toBeGreaterThanOrEqual(3)
    expect(preview.ok).toBe(true)
  })

  it('explains an unreadable file and imports nothing', () => {
    const preview = previewImport('{ this is not json', EMPTY)
    expect(preview.ok).toBe(false)
    expect(preview.counts.things).toBe(0)
    expect(preview.problems[0]).toContain('not valid JSON')
  })

  it('refuses a file that contains no LOWTIDE records', () => {
    const preview = previewImport(JSON.stringify({ hello: 'world' }), EMPTY)
    expect(preview.ok).toBe(false)
    expect(preview.problems[0]).toContain('No LOWTIDE records')
  })

  it('skips a capsule whose project is nowhere to be found', () => {
    const orphan = JSON.stringify({
      app: 'lowtide',
      version: 2,
      data: { things: [], projects: [], capsules: [{ id: 'c1', projectId: 'missing', nextAction: 'x' }], handoffs: [] },
    })
    const preview = previewImport(orphan, EMPTY)
    expect(preview.counts.capsules).toBe(0)
    expect(preview.problems.join(' ')).toContain('project that is not in this file')
  })

  it('attaches a capsule to a project that already exists here', () => {
    const existing = sampleSnapshot()
    const incoming = JSON.stringify({
      app: 'lowtide',
      version: 2,
      data: {
        things: [],
        projects: [],
        capsules: [{ id: 'c-new', projectId: existing.projects[0].id, nextAction: 'carry on' }],
        handoffs: [],
      },
    })
    const preview = previewImport(incoming, existing)
    expect(preview.counts.capsules).toBe(1)
  })
})
