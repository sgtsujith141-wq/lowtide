import { describe, expect, it } from 'vitest';
import { createDexieRepositories, type BackupData, type Repositories } from '../db/repositories';
import { buildContextPack, renderContextMarkdown } from '../features/context/pack';
import { buildWorkspace } from '../features/context/workspace';
import { crc32, zipFiles } from '../lib/zip';
import { setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

/** Distinctive private strings that must never leave private storage. */
const SECRET = {
  protected: 'Anniversary dinner PRIVATE-PT',
  sleepNote: 'bad night PRIVATE-SLEEP',
  habit: 'Tablets PRIVATE-MED',
  inbox: 'call the doctor PRIVATE-INBOX',
  college: 'Viva voce PRIVATE-COLLEGE',
};

async function seed(r: Repositories) {
  const p = await r.projects.create({
    name: 'Engine',
    state: 'active',
    objective: 'Ship the engine',
    phase: 'Build',
    nextAction: 'Wire the bus',
  });
  const scope = await r.projects.addMilestone(p.id, { title: 'Scope' });
  const build = await r.projects.addMilestone(p.id, { title: 'Build', weight: 3 });
  await r.projects.completeMilestone(scope.id);
  const task = await r.tasks.create({
    title: 'Write loader',
    projectId: p.id,
    milestoneId: build.id,
  });
  await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off API' });
  await r.projects.addItem(p.id, {
    kind: 'dependency',
    title: 'Design review',
    waitingOn: 'a teammate',
  });
  const d = await r.projects.recordDecision(p.id, {
    title: 'Storage',
    decision: 'IndexedDB first',
  });
  await r.projects.recordDecision(p.id, {
    title: 'Storage',
    decision: 'SQLite later',
    supersedesId: d.id,
  });
  const w = await r.work.start({ kind: 'task', taskId: task.id, intent: 'loader' });
  await r.work.finish(w.id, 'half done');
  await r.aiSessions.record({
    client: 'claude-code',
    scope: 'project',
    projectId: p.id,
    startedAt: '2026-09-28T09:00:00.000Z',
    endedAt: '2026-09-28T09:30:00.000Z',
    summary: 'Reviewed the loader',
  });
  await r.projects.create({ name: 'Old thing', state: 'archived' });
  await r.hackathons.create({ name: 'Autumn hack', status: 'active', problemStatement: 'Water' });
  // Private life state:
  await r.protectedTime.create({
    title: SECRET.protected,
    date: '2026-09-28',
    kind: 'relationship',
  });
  const sleep = await r.offTime.start('sleep', SECRET.sleepNote);
  await r.offTime.end(sleep.id);
  const habit = await r.habits.create({ name: SECRET.habit, category: 'health', unit: 'check' });
  await r.habits.setEntry(habit.id, '2026-09-28', 1);
  await r.inbox.capture(SECRET.inbox);
  await r.college.create({ kind: 'exam', title: SECRET.college, date: '2026-09-30' });
  return { projectId: p.id, milestoneId: build.id, taskId: task.id };
}

async function snapshot() {
  const r = createDexieRepositories(newDb(), { clock: steppingClock('2026-09-28T09:00:00.000Z') });
  const ids = await seed(r);
  const data: BackupData = (await r.backup.exportBackup()).data;
  return { data, ...ids };
}

const NOW = new Date('2026-09-28T12:00:00.000Z');
const noSecrets = (text: string, except: string[] = []) => {
  for (const [key, value] of Object.entries(SECRET)) {
    if (!except.includes(key)) expect(text, key).not.toContain(value);
  }
};

describe('context packs (ADR-041, ADR-054)', () => {
  it('builds a PROJECT pack with the full hierarchy and only that project’s technical context', async () => {
    const { data, projectId, milestoneId, taskId } = await snapshot();
    const pack = buildContextPack(data, { kind: 'project', projectId, milestoneId, taskId }, NOW);
    expect(pack.hierarchy).toEqual([
      'GLOBAL',
      'PROJECT: Engine',
      'SUBAREA: Build',
      'CURRENT TASK: Write loader',
    ]);
    const md = renderContextMarkdown(pack);
    for (const expected of [
      '## Objective',
      'Ship the engine',
      'Phase: Build',
      '25% of milestone weight complete (1 of 4).',
      '- [x] Scope',
      '- [>] Build (weight 3)',
      '## Waiting',
      'Design review (waiting on a teammate)',
      '## Needs approval',
      '- Sign off API',
      'Storage: SQLite later',
      'Storage: IndexedDB first (superseded)',
      '## Recent activity',
      'Reached milestone: Scope',
      '## Current task',
      '## Important documents',
    ]) {
      expect(md).toContain(expected);
    }
    expect(md).not.toContain('Old thing');
    expect(md).not.toContain('Autumn hack');
    noSecrets(md);
    expect(pack.sources.some((s) => s.store === 'projects' && s.id === projectId)).toBe(true);
  });

  it('builds a WORKSPACE pack of live projects, what needs the owner, and hackathons', async () => {
    const { data } = await snapshot();
    const md = renderContextMarkdown(buildContextPack(data, { kind: 'workspace' }, NOW));
    expect(md).toContain('- Engine (Active), 25%; next: Wire the bus [projects/engine/]');
    expect(md).toContain('- Approve (Engine): Sign off API');
    expect(md).toContain('Autumn hack');
    expect(md).not.toContain('Old thing');
    noSecrets(md);
  });

  it('includes private areas in GLOBAL only when granted, and never protected time', async () => {
    const { data } = await snapshot();
    const none = renderContextMarkdown(buildContextPack(data, { kind: 'global', grants: {} }, NOW));
    noSecrets(none);
    const all = buildContextPack(
      data,
      { kind: 'global', grants: { routines: true, offTime: true, college: true, inbox: true } },
      NOW,
    );
    const md = renderContextMarkdown(all);
    expect(all.granted).toEqual(['routines', 'offTime', 'college', 'inbox']);
    expect(md).toContain(SECRET.habit);
    expect(md).toContain(SECRET.inbox);
    expect(md).toContain(SECRET.college);
    expect(md).toContain('marked');
    expect(md).not.toContain(SECRET.protected);
    expect(md).toContain('Protected time is never included.');
  });
});

describe('technical workspace export (ADR-044, ADR-054)', () => {
  it('writes the documented hierarchy', async () => {
    const { data } = await snapshot();
    const files = buildWorkspace(data, NOW);
    const paths = [...files.keys()];
    for (const expected of [
      'README.md',
      '.lowtide/manifest.json',
      'projects/engine/PROJECT.md',
      'projects/engine/CONTEXT.md',
      'projects/engine/decisions/0001-storage.md',
      'projects/engine/decisions/0002-storage.md',
      'projects/engine/.lowtide/summary.json',
      'projects/engine/planning/.gitkeep',
      'projects/engine/research/.gitkeep',
      'projects/engine/docs/.gitkeep',
      'projects/engine/files/.gitkeep',
      'projects/engine/assets/.gitkeep',
      'projects/engine/ai/handoffs/.gitkeep',
      'projects/engine/ai/summaries/.gitkeep',
      'projects/engine/archive/.gitkeep',
      'archive/projects/old-thing/PROJECT.md',
      'inbox/.gitkeep',
      'daily/2026-09.md',
    ]) {
      expect(paths).toContain(expected);
    }
    expect(
      paths.some((p) => /^projects\/engine\/ai\/sessions\/2026-09-28-claude-code-/.test(p)),
    ).toBe(true);
    expect(paths.some((p) => p.startsWith('hackathons/autumn-hack-'))).toBe(true);
    expect(files.get('projects/engine/decisions/0001-storage.md')).toContain(
      '- Status: Superseded',
    );
    const summary = JSON.parse(files.get('projects/engine/.lowtide/summary.json')!);
    expect(summary).toMatchObject({ slug: 'engine', completionPercent: 25 });
    expect(summary.lanes.waiting).toEqual([{ title: 'Design review', waitingOn: 'a teammate' }]);
    expect(files.get('daily/2026-09.md')).toContain('Engine: 1 m, loader → half done');
  });

  it('never writes protected time, sleep, routines, medication, college records or inbox', async () => {
    const { data } = await snapshot();
    const files = buildWorkspace(data, NOW);
    for (const [path, text] of files) {
      noSecrets(`${path}\n${text}`);
      expect(path).not.toMatch(/protected|sleep|habit|routine|inbox\/.+\.md|college/i);
    }
    expect(files.get('inbox/.gitkeep')).toBe('');
  });

  it('is deterministic for the same data and time', async () => {
    const { data } = await snapshot();
    expect([...buildWorkspace(data, NOW)]).toEqual([...buildWorkspace(data, NOW)]);
  });
});

describe('zip writer', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('writes a readable stored archive with UTF-8 names', () => {
    const files = new Map([
      ['README.md', '# Hello'],
      ['projects/énergie/PROJECT.md', 'naïve café'],
    ]);
    const zip = zipFiles(files, new Date(2026, 8, 28, 12, 0, 0));
    const view = new DataView(zip.buffer);
    // End of central directory: 2 entries.
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    // Walk the local headers and check names, sizes and CRCs.
    const decoder = new TextDecoder();
    let at = 0;
    const read: [string, string][] = [];
    for (let i = 0; i < 2; i++) {
      expect(view.getUint32(at, true)).toBe(0x04034b50);
      expect(view.getUint16(at + 6, true) & 0x0800).toBe(0x0800);
      const size = view.getUint32(at + 18, true);
      const nameLength = view.getUint16(at + 26, true);
      const name = decoder.decode(zip.subarray(at + 30, at + 30 + nameLength));
      const data = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
      expect(view.getUint32(at + 14, true)).toBe(crc32(data));
      read.push([name, decoder.decode(data)]);
      at += 30 + nameLength + size;
    }
    expect(read).toEqual([...files]);
  });
});
