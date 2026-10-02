import { afterAll, describe, expect, it } from 'vitest';
import { asStore, openDatabase, type LowtideDatabase } from '../db/database';
import { importNotion, parsePlan, type ImportReport } from '../db/import/notion/importer';
import { convertBody } from '../db/import/notion/body';
import { createDexieRepositories } from '../db/repositories';
import type { SpaceNode } from '../types/domain';
import { fixturePlan, fixtureSnapshot, ID } from './notion-fixture';
import { recordWatch, setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

function setup() {
  const db = newDb();
  let n = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const store = asStore(db);
  const run = (at = '2026-02-10T12:00:00.000Z', extra: { dryRun?: boolean } = {}) =>
    importNotion(store, fixtureSnapshot(), fixturePlan(), { now: new Date(at), newId, ...extra });
  return { db, store, run };
}

/**
 * One import shared by the tests that only read its result: importing is the
 * expensive part, and running it once keeps this file light on a busy machine.
 */
let sharedRun: Promise<{ db: LowtideDatabase; report: ImportReport }> | undefined;
function shared() {
  sharedRun ??= (async () => {
    const db = openDatabase(`lowtide-test-${crypto.randomUUID()}`);
    let n = 0;
    const report = await importNotion(asStore(db), fixtureSnapshot(), fixturePlan(), {
      now: new Date('2026-02-10T12:00:00.000Z'),
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    return { db, report };
  })();
  return sharedRun;
}
afterAll(async () => {
  if (sharedRun) await (await sharedRun).db.delete();
});

const bySource = async (db: ReturnType<typeof newDb>, sourceId: string, type: string) =>
  db.sourceRecords.where('[system+sourceId+entityType]').equals(['notion', sourceId, type]).first();

async function nodeOf(db: ReturnType<typeof newDb>, sourceId: string): Promise<SpaceNode> {
  const record = await bySource(db, sourceId, 'spaceNode');
  const node = record && (await db.spaceNodes.get(record.entityId));
  if (!node) throw new Error(`no node for ${sourceId}`);
  return node;
}

describe('Notion import: structured records', () => {
  it('makes one project per canonical source, keeping duplicates as provenance', async () => {
    const { db } = await shared();
    const projects = await db.projects.toArray();
    expect(projects.map((p) => [p.slug, p.state, p.objective, p.nextAction])).toEqual(
      expect.arrayContaining([
        ['widget', 'active', 'Ship a small widget', 'Write the launch post'],
        ['gadget', 'planning', undefined, undefined],
      ]),
    );
    expect(projects).toHaveLength(2);
    const widget = projects.find((p) => p.slug === 'widget')!;
    // Its state dates from Notion's last record of it, not from the import.
    expect(widget.stateChangedAt).toBe('2026-01-02T10:00:00.000Z');
    expect(widget.createdAt).toBe('2026-01-02T10:00:00.000Z');
    expect(widget.updatedAt).toBe('2026-01-02T10:00:00.000Z');
    const legacy = await bySource(db, ID.rowWidgetOld, 'project');
    expect(legacy).toMatchObject({ entityId: widget.id, role: 'legacy' });
    expect(await bySource(db, ID.hq, 'project')).toMatchObject({ role: 'reference' });
    // A non-empty Blocker became an open blocker item, so Needs you can see it.
    const items = await db.projectItems.where('projectId').equals(widget.id).toArray();
    expect(items.map((i) => [i.kind, i.lane, i.title, i.laneChangedAt])).toEqual([
      ['blocker', 'blocked', 'Waiting for the owner to pick a name', '2026-01-02T10:00:00.000Z'],
    ]);
  });

  it('imports tasks through relations (legacy rows resolve to their project) and merges duplicates', async () => {
    const { db, report } = await shared();
    const widget = (await db.projects.where('slug').equals('widget').first())!;
    const tasks = await db.tasks.toArray();
    expect(tasks.map((t) => t.title).sort()).toEqual([
      'Launch',
      'Widget: draft copy',
      'Widget: ship v1',
    ]);
    const ship = tasks.find((t) => t.title === 'Widget: ship v1')!;
    expect(ship).toMatchObject({
      status: 'doing',
      priority: 'high',
      projectId: widget.id,
      notes: 'Deploy ~ carefully',
    });
    expect(ship.createdAt).toBe('2026-01-01T08:00:00.000Z');
    const draft = tasks.find((t) => t.title === 'Widget: draft copy')!;
    // Canonical row kept its status; the duplicate filled in the due day and phase.
    expect(draft.status).toBe('done');
    expect(draft.dueAt).toBeDefined();
    const foundation = (await db.milestones.where('projectId').equals(widget.id).toArray()).find(
      (m) => m.title === '0 Foundation',
    )!;
    expect(draft.milestoneId).toBe(foundation.id);
    expect(await bySource(db, ID.phaseTaskDraft, 'task')).toMatchObject({
      entityId: draft.id,
      role: 'legacy',
    });
    expect(report.conflicts.some((c) => c.sourceId === ID.taskDraft)).toBe(true);
    // Milestones only for phases in use, in option order.
    const milestones = await db.milestones.where('projectId').equals(widget.id).sortBy('order');
    expect(milestones.map((m) => [m.order, m.title, m.completedAt])).toEqual([
      [0, '0 Foundation', undefined],
      [1, '1 Build', undefined],
    ]);
  });

  it('reconciles an explicit milestone set: ordered, done by Notion’s edit, still tasks, idempotent, never activity', async () => {
    const db = newDb();
    let n = 0;
    const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const plan = {
      ...fixturePlan(),
      milestoneSets: [
        {
          project: 'widget',
          rows: [ID.taskDraft, ID.taskShip],
          evidence: ID.hq,
          reason: 'The dashboard counts these rows as milestones',
        },
      ],
    };
    const run = (at: string) =>
      importNotion(asStore(db), fixtureSnapshot(), plan, { now: new Date(at), newId });
    await run('2026-02-10T12:00:00.000Z');
    const widget = (await db.projects.where('slug').equals('widget').first())!;
    const milestones = await db.milestones.where('projectId').equals(widget.id).sortBy('order');
    // After the phase milestones the project already had; the name prefix is dropped.
    expect(milestones.map((m) => [m.order, m.title, m.completedAt])).toEqual([
      [0, '0 Foundation', undefined],
      [1, '1 Build', undefined],
      [2, 'Draft copy', '2026-01-02T10:00:00.000Z'],
      [3, 'Ship v1', undefined],
    ]);
    // Provenance names the row; the rows stay tasks.
    expect(await bySource(db, ID.taskDraft, 'milestone')).toMatchObject({
      entityId: milestones[2]!.id,
      role: 'canonical',
      originalTitle: 'Widget: draft copy',
    });
    expect((await db.tasks.toArray()).map((t) => t.title)).toContain('Widget: draft copy');
    // No event, no snapshot, no square.
    expect(await db.events.count()).toBe(0);
    expect(await db.progressSnapshots.count()).toBe(0);
    const sources = recordWatch(
      createDexieRepositories(db).activity.watchSources('2026-01-01', '2026-01-31'),
    );
    expect((await sources.until(() => true)).milestones).toEqual([]);
    sources.stop();
    // Idempotent.
    const again = await run('2026-02-11T12:00:00.000Z');
    expect(await db.milestones.count()).toBe(4);
    expect(again.counts.milestone).toEqual({ unchanged: 4 });
  });

  it('refuses a milestone row that isn’t a planned task row', async () => {
    const db = newDb();
    const report = await importNotion(
      asStore(db),
      fixtureSnapshot(),
      {
        ...fixturePlan(),
        milestoneSets: [{ project: 'widget', rows: [ID.eventJam], reason: 'test' }],
      },
      { now: new Date('2026-02-10T12:00:00.000Z'), newId: () => crypto.randomUUID() },
    );
    expect(report.failures.some((f) => f.sourceId === ID.eventJam)).toBe(true);
    expect(await db.milestones.count()).toBe(2);
  });

  it('imports hackathons, moving an end date that precedes the start into notes', async () => {
    const { db } = await shared();
    const hackathons = await db.hackathons.toArray();
    expect(hackathons.find((h) => h.name === 'Game Jam')).toMatchObject({
      status: 'active',
      registrationStatus: 'registered',
      buildStatus: 'demo_ready',
      pptStatus: 'not_started',
      eventStart: '2026-02-01',
      eventEnd: '2026-02-02',
      team: 'Team A',
    });
    const cup = hackathons.find((h) => h.name === 'Code Cup')!;
    expect(cup.eventEnd).toBeUndefined();
    expect(cup.notes).toContain('2026-03-01');
    expect(cup.researchStatus).toBeUndefined();
  });

  it('imports a decision only when it concerns exactly one project', async () => {
    const { db, report } = await shared();
    const decisions = await db.decisions.toArray();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      title: 'Use a web app',
      decision: '**Chosen Action:** Build it as a web app.\n\n**Rationale:** Fastest to ship.',
      context: 'Choosing a platform.',
      decidedAt: '2026-01-02T07:30:00.000Z',
      origin: 'ai-client',
      client: 'Assistant',
    });
    expect(report.spaceOnly.map((s) => s.sourceId)).toContain(ID.decisionTwo);
  });
});

describe('Notion import: SPACE', () => {
  it('builds the section roots and keeps Notion’s hierarchy under placements', async () => {
    const { db } = await shared();
    const roots = (await db.spaceNodes.toArray()).filter((n) => n.parentId === undefined);
    expect(roots.sort((a, b) => a.order - b.order).map((n) => n.key)).toEqual([
      'projects',
      'hackathons',
      'college',
      'ideas',
      'personal',
      'archive',
    ]);
    const widget = (await db.projects.where('slug').equals('widget').first())!;
    const projectNode = (await db.spaceNodes.where('key').equals(`project:${widget.id}`).first())!;
    expect(projectNode.links).toEqual([{ type: 'project', id: widget.id }]);
    const planning = (await db.spaceNodes
      .where('key')
      .equals(`project:${widget.id}:planning`)
      .first())!;
    expect(planning.parentId).toBe(projectNode.id);
    const plan = await nodeOf(db, ID.plan);
    expect(plan.parentId).toBe(planning.id);
    // A database found inside the plan page stays under it.
    const phaseTable = await nodeOf(db, ID.phaseTasksDb);
    expect(phaseTable.parentId).toBe(plan.id);
    // The HQ page went to Ideas/Acme; its unplaced children follow it, in body order.
    const hq = await nodeOf(db, ID.hq);
    const ideasAcme = await db.spaceNodes.get(hq.parentId!);
    expect(ideasAcme).toMatchObject({ key: 'ideas/acme', title: 'Acme' });
    const children = await createDexieRepositories(db).space.watchChildren;
    const watched = recordWatch(children(hq.id));
    const kids = await watched.until((v) => v.length > 0);
    watched.stop();
    expect(kids.map((k) => k.title)).toEqual(['Tasks', 'Decision Log']);
  });

  it('marks archived placements and everything under them', async () => {
    const { db } = await shared();
    const graveyard = await nodeOf(db, ID.graveyard);
    const old = await nodeOf(db, ID.oldIdea);
    const archive = (await db.spaceNodes.where('key').equals('archive').first())!;
    expect(graveyard).toMatchObject({ parentId: archive.id, archived: true });
    expect(old).toMatchObject({ parentId: graveyard.id, archived: true });
  });

  it('keeps provenance on every node and record', async () => {
    const { db } = await shared();
    const plan = await nodeOf(db, ID.plan);
    expect(plan.source).toMatchObject({
      system: 'notion',
      sourceId: ID.plan,
      url: `https://app.notion.com/p/${ID.plan}`,
      originalTitle: 'Widget Plan',
      path: ['Acme HQ'],
      importedAt: '2026-02-10T12:00:00.000Z',
    });
    const widget = (await db.projects.where('slug').equals('widget').first())!;
    const sources = recordWatch(
      createDexieRepositories(db).space.watchSources('project', widget.id),
    );
    const list = await sources.until((v) => v.length > 0);
    sources.stop();
    expect(list.map((s) => s.role)).toEqual(['canonical', 'legacy', 'reference']);
    expect(list[0]).toMatchObject({ sourceId: ID.rowWidget, originalTitle: 'Widget' });
  });

  it('maps a row with a body to both a record and a linked SPACE page', async () => {
    const { db } = await shared();
    const ship = (await db.tasks.toArray()).find((t) => t.title === 'Widget: ship v1')!;
    const page = await nodeOf(db, ID.taskShip);
    expect(page.body).toBe('Launch checklist lives here.');
    expect(page.links).toContainEqual({ type: 'task', id: ship.id });
    const table = await nodeOf(db, ID.tasksDb);
    expect(page.parentId).toBe(table.id);
    const row = table.table!.rows.find((r) => r.id === ID.taskShip)!;
    expect(row.pageId).toBe(page.id);
    expect(row.links).toContainEqual({ type: 'task', id: ship.id });
    // A row without a body gets no page of its own.
    expect(await bySource(db, ID.rowGadget, 'spaceNode')).toBeUndefined();
  });

  it('turns databases into real tables with typed columns and links', async () => {
    const { db } = await shared();
    const colours = await nodeOf(db, ID.colorsDb);
    expect(colours.kind).toBe('table');
    const types = Object.fromEntries(colours.table!.columns.map((c) => [c.name, c.type]));
    expect(types).toEqual({
      Colour: 'text',
      Hex: 'text',
      Used: 'boolean',
      Weight: 'number',
      Tags: 'multiSelect',
      Pair: 'link',
      Task: 'link',
      Since: 'date',
      Link: 'url',
    });
    expect(colours.table!.columns[0]!.name).toBe('Colour');
    const red = colours.table!.rows.find((r) => r.id === ID.colorRed)!;
    const ship = (await db.tasks.toArray()).find((t) => t.title === 'Widget: ship v1')!;
    expect(red.cells).toEqual({
      colour: 'Red',
      hex: '#f00',
      used: true,
      weight: 3,
      tags: ['warm', 'bold'],
      pair: [{ type: 'spaceNode', id: colours.id, rowId: ID.colorBlue, label: 'Blue' }],
      task: [{ type: 'task', id: ship.id, label: 'Widget: ship v1' }],
      since: '2026-01-01/2026-01-31',
      link: 'https://example.com/red',
    });
    // Rollups can't be resolved offline and are left out, not faked.
    const projects = await nodeOf(db, ID.projectsDb);
    expect(projects.table!.columns.map((c) => c.name)).not.toContain('Open');
  });

  it('rewrites references and keeps attachments as external references', async () => {
    const { db, report } = await shared();
    const plan = await nodeOf(db, ID.plan);
    const spec = await nodeOf(db, ID.spec);
    expect(plan.bodyFormat).toBe('notion');
    expect(plan.body).toContain(`[Widget Spec](space:${spec.id})`);
    expect(plan.body).toContain(`[Elsewhere](https://app.notion.com/p/${'9'.repeat(32)})`);
    expect(plan.body).toContain('[Brief](attachment:');
    expect(plan.body).not.toContain('<empty-block');
    expect(plan.attachments).toEqual([
      expect.objectContaining({
        kind: 'file',
        name: 'Brief',
        status: 'external',
        url: 'https://files.example.com/signed/brief.pdf?sig=1',
      }),
    ]);
    expect(report.attachments).toHaveLength(1);
  });

  it('skips linked views and planned skips, and says why', async () => {
    const { db, report } = await shared();
    expect(report.skipped.map((s) => s.sourceId)).toEqual(
      expect.arrayContaining([ID.viewOfTasks, ID.taskBlank]),
    );
    expect(await bySource(db, ID.viewOfTasks, 'spaceNode')).toBeUndefined();
    expect((await db.tasks.toArray()).some((t) => t.title === '')).toBe(false);
  });
});

describe('Notion import: safety', () => {
  const totals = async (db: ReturnType<typeof newDb>) => ({
    projects: await db.projects.count(),
    tasks: await db.tasks.count(),
    milestones: await db.milestones.count(),
    items: await db.projectItems.count(),
    decisions: await db.decisions.count(),
    hackathons: await db.hackathons.count(),
    nodes: await db.spaceNodes.count(),
    sources: await db.sourceRecords.count(),
  });

  it('is idempotent: a second run changes nothing and duplicates nothing', async () => {
    const { db, run } = setup();
    await run();
    const first = await totals(db);
    const nodes = await db.spaceNodes.toArray();
    const report: ImportReport = await run('2026-02-11T12:00:00.000Z');
    expect(await totals(db)).toEqual(first);
    const actions = new Set(report.entities.map((e) => e.action));
    expect([...actions].sort()).toEqual(['provenance', 'unchanged']);
    expect(await db.spaceNodes.toArray()).toEqual(nodes);
  });

  it('keeps LOWTIDE’s value when a record changed there after the import', async () => {
    const { db, store, run } = setup();
    await run();
    const widget = (await db.projects.where('slug').equals('widget').first())!;
    await db.projects.put({
      ...widget,
      nextAction: 'Owner’s own next step',
      updatedAt: '2026-02-10T13:00:00.000Z',
    });
    const changed = fixtureSnapshot();
    changed.databases[0]!.dataSources[0]!.rows[0]!.Next = 'A newer Notion next step';
    const report = await importNotion(store, changed, fixturePlan(), {
      now: new Date('2026-02-12T00:00:00.000Z'),
      newId: () => crypto.randomUUID(),
    });
    expect((await db.projects.get(widget.id))!.nextAction).toBe('Owner’s own next step');
    expect(
      report.entities.find((e) => e.sourceId === ID.rowWidget && e.entityType === 'project')
        ?.action,
    ).toBe('kept-lowtide');
    expect(report.conflicts.some((c) => c.sourceId === ID.rowWidget)).toBe(true);
  });

  it('updates from Notion when LOWTIDE hasn’t touched the record', async () => {
    const { db, store, run } = setup();
    await run();
    const changed = fixtureSnapshot();
    changed.databases[0]!.dataSources[0]!.rows[0]!.Next = 'A newer Notion next step';
    await importNotion(store, changed, fixturePlan(), {
      now: new Date('2026-02-12T00:00:00.000Z'),
      newId: () => crypto.randomUUID(),
    });
    expect((await db.projects.where('slug').equals('widget').first())!.nextAction).toBe(
      'A newer Notion next step',
    );
  });

  it('never rewrites an imported decision', async () => {
    const { db, store, run } = setup();
    await run();
    const changed = fixtureSnapshot();
    changed.databases[4]!.dataSources[0]!.rows[0]!['Chosen Action'] = 'Build a desktop app.';
    const report = await importNotion(store, changed, fixturePlan(), {
      now: new Date('2026-02-12T00:00:00.000Z'),
      newId: () => crypto.randomUUID(),
    });
    expect((await db.decisions.toArray())[0]!.decision).toContain('web app');
    expect(report.conflicts.some((c) => c.sourceId === ID.decisionOne)).toBe(true);
  });

  it('treats an unchanged decision as unchanged when only the fingerprint’s form differs', async () => {
    const { db, run } = setup();
    await run();
    const record = (await bySource(db, ID.decisionOne, 'decision'))!;
    await db.sourceRecords.put({ ...record, contentHash: 'from-an-older-importer' });
    const report = await run('2026-02-11T00:00:00.000Z');
    expect(report.conflicts.filter((c) => c.sourceId === ID.decisionOne)).toEqual([]);
    expect((await bySource(db, ID.decisionOne, 'decision'))!.contentHash).not.toBe(
      'from-an-older-importer',
    );
  });

  it('prefers records LOWTIDE already had (same slug, same hackathon name)', async () => {
    const { db, run } = setup();
    const r = createDexieRepositories(db);
    const own = await r.projects.create({ name: 'Widget', objective: 'The owner’s objective' });
    const jam = await r.hackathons.create({ name: 'game jam', team: 'Owner team' });
    const report = await run();
    expect(await db.projects.where('slug').equals('widget').count()).toBe(1);
    expect((await db.projects.get(own.id))!.objective).toBe('The owner’s objective');
    expect((await db.hackathons.get(jam.id))!.team).toBe('Owner team');
    expect(await db.hackathons.count()).toBe(2);
    expect(
      report.entities
        .filter((e) => e.action === 'linked-existing')
        .map((e) => e.entityType)
        .sort(),
    ).toEqual(['hackathon', 'project']);
  });

  it('doesn’t recreate a record the owner removed after importing it', async () => {
    const { db, run } = setup();
    await run();
    const item = (await db.projectItems.toArray())[0]!;
    await db.projectItems.delete(item.id);
    const report = await run('2026-02-11T00:00:00.000Z');
    expect(await db.projectItems.count()).toBe(0);
    expect(report.entities.some((e) => e.action === 'removed-in-lowtide')).toBe(true);
  });

  it('fabricates no history: no events, sessions, snapshots, AI sessions or completion times', async () => {
    const { db } = await shared();
    expect(await db.events.count()).toBe(0);
    expect(await db.workSessions.count()).toBe(0);
    expect(await db.progressSnapshots.count()).toBe(0);
    expect(await db.aiSessions.count()).toBe(0);
    const done = (await db.tasks.toArray()).filter((t) => t.status === 'done');
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((t) => t.completedAt === undefined)).toBe(true);
  });

  it('keeps imported records out of activity (the Daily Pulse) even when they carry dates', async () => {
    const { db, run } = setup();
    await run();
    const r = createDexieRepositories(db);
    const task = (await db.tasks.toArray()).find((t) => t.status === 'done')!;
    await db.tasks.put({ ...task, completedAt: '2026-01-02T10:00:00.000Z' });
    const sources = recordWatch(r.activity.watchSources('2026-01-01', '2026-01-31'));
    const value = await sources.until(() => true);
    sources.stop();
    expect(value.completedTasks).toEqual([]);
    expect(value.decisions).toEqual([]);
    // A task finished in LOWTIDE itself still counts.
    const own = await r.tasks.create({ title: 'Real work' });
    await r.tasks.complete(own.id);
    const after = recordWatch(r.activity.watchSources('2026-01-01', '2099-12-31'));
    const later = await after.until((v) => v.completedTasks.length > 0);
    after.stop();
    expect(later.completedTasks.map((t) => t.id)).toEqual([own.id]);
  });

  it('rolls everything back on a dry run', async () => {
    const { db, run } = setup();
    const report = await run(undefined, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.entities.length).toBeGreaterThan(0);
    expect(await db.projects.count()).toBe(0);
    expect(await db.spaceNodes.count()).toBe(0);
    expect(await db.sourceRecords.count()).toBe(0);
  });

  it('refuses an invalid plan before touching anything', async () => {
    expect(() => parsePlan({ version: 2 })).toThrow(/Not a valid migration plan/);
    expect(() =>
      parsePlan({ ...fixturePlan(), placements: [{ id: ID.plan, under: 'somewhere/else' }] }),
    ).toThrow();
  });
});

describe('Notion bodies', () => {
  it('links imported targets to SPACE and the rest to Notion', () => {
    const body = [
      '<page url="https://app.notion.com/p/aa000000000000000000000000000001">Child</page>',
      '<database url="https://app.notion.com/p/aa000000000000000000000000000002" inline="true"></database>',
      '<image source="https://img.example.com/a/diagram.png"></image>',
    ].join('\n');
    const out = convertBody(
      body,
      'aa000000000000000000000000000000',
      (id) => (id.endsWith('1') ? 'node-1' : undefined),
      (id) => (id.endsWith('2') ? 'Table' : undefined),
    );
    expect(out.body).toBe(
      [
        '[Child](space:node-1)',
        '[Table](https://app.notion.com/p/aa000000000000000000000000000002)',
        '[diagram.png](attachment:aa000000000000000000000000000000#image-1)',
      ].join('\n'),
    );
    expect(out.references).toHaveLength(2);
    expect(out.attachments[0]).toMatchObject({
      kind: 'image',
      name: 'diagram.png',
      status: 'external',
    });
  });
});
