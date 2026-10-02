import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { asStore } from '../db/database';
import { importNotion } from '../db/import/notion/importer';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { fixturePlan, fixtureSnapshot, ID } from './notion-fixture';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function room(seed: (r: Repositories) => Promise<unknown>, slug = 'engine') {
  const repositories = createDexieRepositories(newDb());
  await seed(repositories);
  const rendered = await renderApp(`/projects/${slug}`, repositories);
  // The room renders once every live query has answered.
  await screen.findByRole('tablist', { name: 'Project sections' }, { timeout: 10_000 });
  return { repositories, ...rendered };
}

const engine = (r: Repositories) => r.projects.create({ name: 'Engine', state: 'active' });

async function watchOnce<T>(watch: (cb: (v: T) => void) => () => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const stop = watch((v) => {
      stop();
      resolve(v);
    });
  });
}

describe('Projects overview (v2 PHASE 013)', () => {
  it('creates a project and opens its command room', async () => {
    const repositories = createDexieRepositories(newDb());
    const { user } = await renderApp('/projects', repositories);
    expect(await screen.findByText(/No active projects/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tide Engine');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tide Engine' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('tab', { name: 'Overview' }, { timeout: 10_000 }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('orders the portfolio by focus, in tiers of full-width rows, without falsifying records', async () => {
    const repositories = createDexieRepositories(newDb());
    const make = async (
      name: string,
      focus?: 'primary' | 'secondary' | 'supporting' | 'background',
      state: 'active' | 'planning' = 'active',
    ) => {
      const p = await repositories.projects.create({ name, state });
      if (focus) await repositories.projects.setFocus(p.id, focus);
      return p;
    };
    await make('Side', 'background');
    await make('Later one', 'background', 'planning');
    const helper = await make('Helper', 'supporting');
    await make('Second', 'secondary');
    const main = await make('Main', 'primary');
    await repositories.projects.addMilestone(main.id, { title: 'Scope' });
    const m = await repositories.projects.addMilestone(main.id, { title: 'Build' });
    await repositories.projects.addMilestone(main.id, { title: 'Launch' });
    await repositories.projects.completeMilestone(
      (await watchOnce(repositories.projects.watchMilestones(main.id)))[0]!.id,
    );
    await repositories.projects.addItem(helper.id, {
      kind: 'blocker',
      title: 'Not listed in either portfolio (Plan A / Plan B) - confirm its position',
    });
    const before = await watchOnce(repositories.projects.watchAll);

    await renderApp('/projects', repositories);
    await screen.findByRole('heading', { level: 3, name: 'Main' }, { timeout: 10_000 });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Primary',
      'Secondary',
      'Supporting',
      'Later',
      'Not current',
    ]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Main',
      'Second',
      'Helper',
      'Later one',
      'Side',
    ]);
    // Milestone progress, the roadmap and the current stage.
    expect(
      screen.getByRole('progressbar', { name: 'Main: 33% of milestone weight done' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 3 milestones')).toBeInTheDocument();
    const mainRow = screen.getByRole('heading', { level: 3, name: 'Main' }).closest('li')!;
    expect(within(mainRow).getAllByText('Build').length).toBeGreaterThan(0);
    expect(within(mainRow).getByText('Now').nextSibling).toHaveTextContent(m.title);
    expect(within(mainRow).getByText('Next').nextSibling).toHaveTextContent('Launch');
    // Imported prose is said plainly; the original is one hover away.
    const need = screen.getByText('Portfolio position needs confirmation');
    expect(need.closest('[title]')).toHaveAttribute('title', expect.stringMatching(/^Not listed/));
    // No percentage without milestones; nothing rewritten to make the order.
    expect(screen.getAllByText('No milestones yet, so no percentage.').length).toBe(2);
    expect(await watchOnce(repositories.projects.watchAll)).toEqual(before);
  });

  it('says so for an unknown project', async () => {
    await renderApp('/projects/nope', createDexieRepositories(newDb()));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Project not found' }),
    ).toBeInTheDocument();
  });
});

describe('Project Command Room (v2 PHASE 013)', () => {
  it('opens on the project itself: name, state and priority, progress, roadmap, Start Work, then tabs', async () => {
    await room(async (r) => {
      const p = await engine(r);
      await r.projects.update(p.id, { objective: 'Ship a calm engine' });
    });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Engine' });
    const start = await screen.findByRole('button', { name: 'Start work' });
    const tabs = screen.getByRole('tablist', { name: 'Project sections' });
    expect(h1.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Project state' })).toHaveValue('active');
    expect(screen.getByRole('combobox', { name: 'Focus' })).toHaveValue('');
    expect(screen.getAllByText('Ship a calm engine').length).toBeGreaterThan(0);
    expect(screen.getByText(/Progress comes only from milestones/)).toBeInTheDocument();
  });

  it('derives progress from milestones only, marks the current stage, and opens a milestone’s details', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      await r.projects.addMilestone(p.id, { title: 'Scope', weight: 1 });
      await r.projects.addMilestone(p.id, { title: 'Build', weight: 3 });
    });
    const roadmap = screen.getByRole('list', { name: 'Roadmap' });
    // Vertical on narrow screens, horizontal from xl.
    expect(roadmap).toHaveClass('flex-col', 'xl:flex-row');
    const steps = within(roadmap).getAllByRole('listitem');
    expect(steps[0]).toHaveAttribute('aria-current', 'true');
    expect(steps[0]).toHaveTextContent('Scope (current)');
    expect(steps[1]).toHaveTextContent('Build (upcoming, weight 3)');

    await user.click(within(steps[0]!).getByRole('button'));
    const drawer = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(drawer).getByText('1 of 2')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Complete milestone' }));
    expect(
      await within(drawer).findByRole('button', { name: 'Reopen milestone' }),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(
      await screen.findByRole('progressbar', { name: 'Engine: 25% of milestone weight done' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 2 milestones, by weight')).toBeInTheDocument();
    expect(within(roadmap).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'true');
    // A real milestone change is a real point on the progress chart.
    expect(
      await screen.findByRole('img', { name: /^Milestone completion from .*now 25%$/ }),
    ).toBeInTheDocument();
  });

  it('draws sparse progress honestly and shows no time chart without sessions', async () => {
    await room(async (r) => {
      const p = await engine(r);
      await r.projects.addMilestone(p.id, { title: 'Scope' });
    });
    // Adding the milestone recorded one real point; nothing before it is drawn.
    expect(
      await screen.findByRole('img', { name: /^Milestone completion from .*: .* 0%; now 0%$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('No work sessions on this project yet.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Work per week/ })).not.toBeInTheDocument();
  });

  it('lays out the work plane: now, next and needs you first; approvals resolve in place', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off copy' });
      await r.projects.addItem(p.id, { kind: 'focus', title: 'Engine: wire the bus' });
      await r.projects.addItem(p.id, { kind: 'idea', title: 'OCR' });
      await r.tasks.create({ title: 'Refactor scheduler', projectId: p.id });
    });
    const region = (name: string) => screen.getByRole('region', { name });
    expect(within(region('Now')).getByText('Wire the bus')).toBeInTheDocument();
    expect(within(region('Next')).getByText('Refactor scheduler')).toBeInTheDocument();
    expect(within(region('Parked')).getByText('OCR')).toBeInTheDocument();
    const needs = region('Needs you');
    expect(within(needs).getByText('Approval')).toBeInTheDocument();
    await user.click(within(needs).getByRole('button', { name: 'Details: Sign off copy' }));
    const drawer = await screen.findByRole('dialog', { name: 'Sign off copy' });
    expect(within(drawer).getByText('As recorded')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await user.click(within(needs).getByRole('button', { name: 'Approve: Sign off copy' }));
    expect(
      await within(region('Needs you')).findByText('Nothing is waiting on you.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Done (1)')).toBeInTheDocument();
  });

  it('keeps full lane editing on the Work tab', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      await r.projects.addItem(p.id, { kind: 'step', title: 'Write loader' });
    });
    await user.click(screen.getByRole('tab', { name: 'Work' }));
    const lane = (name: string) => screen.getByRole('region', { name });
    await user.selectOptions(
      within(lane('Next')).getByRole('combobox', { name: 'Move Write loader to' }),
      'Parked',
    );
    expect(await within(lane('Parked')).findByText('Write loader')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to the board' }));
    const form = screen.getByRole('form', { name: 'Add to the board' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'Waiting on');
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Design review');
    await user.type(within(form).getByRole('textbox', { name: /Waiting on/ }), 'a teammate');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await within(lane('Waiting')).findByText('Design review')).toBeInTheDocument();
    expect(within(lane('Waiting')).getByText('on a teammate')).toBeInTheDocument();
  });

  it('summarises the project in five facts', async () => {
    await room(async (r) => {
      const p = await engine(r);
      await r.projects.update(p.id, { nextAction: 'Run the first build' });
      await r.projects.addItem(p.id, { kind: 'blocker', title: 'No fixtures' });
    });
    const summary = screen.getByRole('region', { name: 'Project summary' });
    for (const label of [
      'Objective',
      'Current phase',
      'Last meaningful change',
      'Next meaningful action',
      'Health',
    ])
      expect(within(summary).getByText(label)).toBeInTheDocument();
    expect(within(summary).getByText('Run the first build')).toBeInTheDocument();
    expect(within(summary).getByText('Needs you: 1 blocker')).toBeInTheDocument();
    expect(within(summary).getByText('Details updated')).toBeInTheDocument();
  });

  it('refuses Done while milestones are open, and explains how to proceed', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      await r.projects.addMilestone(p.id, { title: 'Last bit' });
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project state' }), 'Done');
    expect(await screen.findByRole('alert')).toHaveTextContent(/record a decision in Docs/);
  });

  it('records immutable decisions in Docs, with supersession', async () => {
    const { user } = await room(engine);
    await user.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(await screen.findByText('No documents for Engine in SPACE yet.')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Record a decision' });
    await user.type(within(form).getByRole('textbox', { name: 'Decision title' }), 'Storage');
    await user.type(
      within(form).getByRole('textbox', { name: 'What was decided' }),
      'IndexedDB first',
    );
    await user.click(within(form).getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('IndexedDB first')).toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'Decision title' }), 'Storage');
    await user.type(
      within(form).getByRole('textbox', { name: 'What was decided' }),
      'SQLite later',
    );
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Supersedes (optional)' }),
      'Storage',
    );
    await user.click(within(form).getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('SQLite later')).toBeInTheDocument();
    expect(await screen.findByText('superseded')).toBeInTheDocument();
  });

  it('previews the project’s SPACE documents by slot, read-only', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    {
      const p = await engine(r);
      await r.space.ensureRoots();
      const projects = (await r.space.getByKey('projects'))!;
      const folder = await r.space.create({
        kind: 'section',
        title: 'Engine',
        parentId: projects.id,
      });
      await db.spaceNodes.update(folder.id, { key: `project:${p.id}` });
      const planning = await r.space.create({
        kind: 'section',
        title: 'Planning',
        parentId: folder.id,
      });
      await db.spaceNodes.update(planning.id, { key: `project:${p.id}:planning` });
      await r.space.create({
        kind: 'page',
        title: 'Master plan',
        parentId: planning.id,
        body: 'Phase 0, then phase 1.',
        bodyFormat: 'markdown',
      });
    }
    const { user } = await renderApp('/projects/engine', r);
    await user.click(await screen.findByRole('tab', { name: 'Docs' }, { timeout: 10_000 }));
    const planning = await screen.findByRole('region', { name: 'Planning' });
    expect(within(planning).getByText('1 item')).toBeInTheDocument();
    await user.click(within(planning).getByRole('button', { name: 'Master plan' }));
    const drawer = await screen.findByRole('dialog', { name: 'Master plan' });
    expect(within(drawer).getByText('Phase 0, then phase 1.')).toBeInTheDocument();
    expect(within(drawer).getByText(/Read-only preview/)).toBeInTheDocument();
  });

  it('moves between restrained tabs with the arrow keys; no GitHub tab without GitHub', async () => {
    const { user } = await room(engine);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Overview',
      'Work',
      'Tasks',
      'Milestones',
      'Docs',
      'AI',
      'History',
    ]);
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    expect(await screen.findByText(/No AI sessions yet/)).toBeInTheDocument();
  });

  it('starts general project work in one press, and the room shows it running', async () => {
    const { user, repositories } = await room(engine);
    await user.click(await screen.findByRole('button', { name: 'Start work' }));
    expect(
      await screen.findByText('Working here', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    const active = await watchOnce(repositories.work.watchActive);
    expect(active).toMatchObject({ kind: 'project' });
    expect(active?.taskId).toBeUndefined();
  });

  it('starts work on a chosen task', async () => {
    const { user, repositories } = await room(async (r) => {
      const p = await engine(r);
      await r.tasks.create({ title: 'Engine: write docs', projectId: p.id });
    });
    await user.click(await screen.findByRole('button', { name: 'Choose what to work on' }));
    const chooser = await screen.findByRole('dialog', { name: 'Start work' }, { timeout: 5000 });
    await user.click(
      await within(chooser).findByRole('option', { name: /Write docs/ }, { timeout: 5000 }),
    );
    const focus = await screen.findByRole('region', { name: 'Work Mode' }, { timeout: 5000 });
    expect(
      await within(focus).findByRole('heading', { name: 'Engine' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      await within(focus).findByText('Write docs', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    const active = await watchOnce(repositories.work.watchActive);
    expect(active?.taskId).toBeDefined();
  });

  it('shows meaningful activity only, led by who did it, with the full record a click away', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      const t = await r.tasks.create({ title: 'Engine: ship it', projectId: p.id });
      await r.tasks.complete(t.id);
    });
    const activity = screen.getByRole('region', { name: 'Activity' });
    const today = await within(activity).findByRole('region', { name: 'Today' });
    expect(within(today).getByText('Completed: Ship it')).toBeInTheDocument();
    expect(within(today).getAllByText('You').length).toBeGreaterThan(0);
    await user.click(within(today).getByText('Completed: Ship it'));
    const drawer = await screen.findByRole('dialog', { name: 'Completed: Ship it' });
    expect(within(drawer).getByText('Engine: ship it')).toBeInTheDocument();
  });

  it('colours the project grid only from real records', async () => {
    await room(engine);
    const grid = screen.getByRole('grid', { name: 'Engine activity, last 6 months' });
    const lit = within(grid)
      .getAllByRole('gridcell')
      .filter((c) => c.getAttribute('data-level') !== '0');
    // Creating the project today is the only record.
    expect(lit.length).toBeLessThanOrEqual(1);
  });

  it('shows a milestone reconciliation in History as an audit entry, never as activity', async () => {
    const db = newDb();
    let n = 0;
    const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    await importNotion(asStore(db), fixtureSnapshot(), fixturePlan(), {
      now: new Date('2026-02-10T12:00:00.000Z'),
      newId,
    });
    await importNotion(
      asStore(db),
      fixtureSnapshot(),
      {
        ...fixturePlan(),
        milestoneSets: [{ project: 'widget', rows: [ID.taskDraft, ID.taskShip], reason: 'test' }],
      },
      { now: new Date('2026-02-11T12:00:00.000Z'), newId },
    );
    const { user } = await renderApp('/projects/widget', createDexieRepositories(db));
    await user.click(await screen.findByRole('tab', { name: 'History' }, { timeout: 10_000 }));
    const trail = await screen.findByRole('region', { name: 'Imported and reconciled' });
    expect(within(trail).getByText(/Milestones reconciled from Notion/)).toBeInTheDocument();
    expect(within(trail).getByText('2 milestones')).toBeInTheDocument();
    expect(within(trail).getByText(/Imported from Notion/)).toBeInTheDocument();
    // The ledger holds nothing for it.
    expect(await db.events.count()).toBe(0);
  });

  it('adds and completes a project task from the Tasks tab', async () => {
    const { user, repositories } = await room(engine);
    await user.click(screen.getByRole('tab', { name: 'Tasks' }));
    await user.type(screen.getByRole('textbox', { name: 'New task for Engine' }), 'Write docs');
    await user.click(
      within(screen.getByRole('form', { name: 'Add a task' })).getByRole('button', { name: 'Add' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Complete: Write docs' }));
    const done = await screen.findByRole('region', { name: 'Done tasks' });
    expect(await within(done).findByText('Write docs')).toBeInTheDocument();
    await vi.waitFor(async () => {
      const closed = await watchOnce(repositories.tasks.watchClosed);
      expect(closed[0]).toMatchObject({ title: 'Write docs' });
    });
  });
});
