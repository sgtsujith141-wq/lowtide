import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { addDays } from '../lib/calendar';
import { toLocalDate } from '../lib/time';
import { setupTestDatabase, expectFocus } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const today = () => toLocalDate(new Date());

/** Habit methods that fail loudly if hackathon code ever reaches them. */
function guardHabits(r: Repositories) {
  const trap = vi.fn(() => {
    throw new Error('hackathon code must not touch habits');
  });
  const habits = Object.fromEntries(
    Object.keys(r.habits).map((k) => [k, trap]),
  ) as unknown as Repositories['habits'];
  return { repositories: { ...r, habits }, trap };
}

async function setup(seed?: (r: Repositories) => Promise<unknown>, path = '/hackathons') {
  const db = newDb();
  const base = createDexieRepositories(db);
  await seed?.(base);
  const { repositories, trap } = guardHabits(base);
  return { db, base, trap, ...(await renderApp(path, repositories)) };
}

/** Opens a hackathon's detail sheet and returns it. */
async function openSheet(user: { click: (el: Element) => Promise<void> }, name: string) {
  await user.click(await screen.findByRole('button', { name: `Open ${name}` }, { timeout: 5000 }));
  return screen.findByRole('dialog', { name });
}

describe('Hackathons page (v2 PHASE 016)', () => {
  it('starts calm and empty', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Hackathons' })).toBeInTheDocument();
    expect(screen.getByText('No hackathons yet.')).toBeInTheDocument();
    expect(screen.queryByText(/%|score/i)).not.toBeInTheDocument();
  });

  it('shows each hackathon as one scannable row, with no editing controls until opened', async () => {
    await setup((r) =>
      r.hackathons.create({
        name: 'Hackurity',
        eventStart: addDays(today(), 3),
        nextAction: 'Confirm registration',
      }),
    );
    const name = await screen.findByRole('heading', { level: 3, name: 'Hackurity' });
    const row = name.closest('li')!;
    expect(row).toHaveTextContent('Starts in 3 days');
    expect(row).toHaveTextContent('NextConfirm registration');
    expect(within(row).getByRole('list', { name: 'Stages for Hackurity' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
  });

  it('adds a hackathon with just a name and a date', async () => {
    const { user, db, trap } = await setup();
    await user.click(screen.getByRole('button', { name: 'Add hackathon' }));
    const form = screen.getByRole('form', { name: 'Add hackathon' });
    expect(within(form).queryByLabelText('Problem statement')).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'Hackurity');
    await user.type(within(form).getByLabelText('Event starts'), addDays(today(), 4));
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    const name = await screen.findByRole('heading', { level: 3, name: 'Hackurity' });
    expect(name.closest('li')).toHaveTextContent('Starts in 4 days');
    expect(await db.hackathons.toArray()).toMatchObject([
      { name: 'Hackurity', eventStart: addDays(today(), 4), status: 'considering' },
    ]);
    expect(await db.habitEntries.count()).toBe(0);
    expect(trap).not.toHaveBeenCalled();
  });

  it('validates the name and the date range with associated errors', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Add hackathon' }));
    const form = screen.getByRole('form', { name: 'Add hackathon' });
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Give it a name.');
    expect(within(form).getByLabelText('Name')).toHaveAccessibleDescription('Give it a name.');
    await user.type(within(form).getByLabelText('Name'), 'x');
    await user.type(within(form).getByLabelText('Event starts'), '2026-10-05');
    await user.type(within(form).getByLabelText('Event ends (optional)'), '2026-10-04');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByLabelText('Event ends (optional)')).toHaveAccessibleDescription(
      'The event can’t end before it starts.',
    );
  });

  it('edits every field in the detail sheet', async () => {
    const { user, db } = await setup((r) => r.hackathons.create({ name: 'AI Build Week' }));
    const sheet = await openSheet(user, 'AI Build Week');
    await user.click(within(sheet).getByRole('button', { name: 'Edit AI Build Week' }));
    const form = within(sheet).getByRole('form', { name: 'Edit AI Build Week' });
    await user.type(within(form).getByLabelText('Registration deadline'), addDays(today(), 1));
    await user.type(within(form).getByLabelText('Event starts'), addDays(today(), 10));
    await user.type(within(form).getByLabelText('Problem statement'), 'PS 7: offline triage');
    await user.type(within(form).getByLabelText('Team'), 'Asha, Ravi');
    await user.type(within(form).getByLabelText('Next action'), 'Register team');
    await user.selectOptions(within(form).getByLabelText('Status'), 'active');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Registration due tomorrow')).toBeInTheDocument();
    expect(within(sheet).getByText('Register team')).toBeInTheDocument();
    expect(within(sheet).getByText('PS 7: offline triage')).toBeInTheDocument();
    expect(within(sheet).getByText('Asha, Ravi')).toBeInTheDocument();
    expect((await db.hackathons.toArray())[0]).toMatchObject({
      registrationDeadline: addDays(today(), 1),
      eventStart: addDays(today(), 10),
      status: 'active',
    });
  });

  it('updates stage statuses from the sheet, keeping focus on the control', async () => {
    const { user, db, trap } = await setup((r) => r.hackathons.create({ name: 'Hackurity' }));
    const sheet = await openSheet(user, 'Hackurity');
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Registration for Hackurity' }),
      'registered',
    );
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'PPT for Hackurity' }),
      'in_progress',
    );
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Build for Hackurity' }),
      'demo_ready',
    );
    await vi.waitFor(async () =>
      expect((await db.hackathons.toArray())[0]).toMatchObject({
        registrationStatus: 'registered',
        pptStatus: 'in_progress',
        buildStatus: 'demo_ready',
      }),
    );
    await expectFocus(() => within(sheet).getByRole('combobox', { name: 'Build for Hackurity' }));
    expect(trap).not.toHaveBeenCalled();
  });

  it('adds and edits the next action in the sheet; Escape cancels', async () => {
    const { user, db } = await setup((r) => r.hackathons.create({ name: 'Hackurity' }));
    const sheet = await openSheet(user, 'Hackurity');
    await user.click(
      within(sheet).getByRole('button', { name: 'Add a next action for Hackurity' }),
    );
    await user.keyboard('Finish PPT outline{Enter}');
    expect(await within(sheet).findByText('Finish PPT outline')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Edit next action for Hackurity' }));
    await user.keyboard('{Control>}a{/Control}ignored{Escape}');
    expect(within(sheet).getByText('Finish PPT outline')).toBeInTheDocument();
    expect((await db.hackathons.toArray())[0]?.nextAction).toBe('Finish PPT outline');
  });

  it('finishing moves a hackathon to Past with everything kept; it can be reopened', async () => {
    const { user, db } = await setup((r) =>
      r.hackathons.create({
        name: 'Old one',
        problemStatement: 'PS 2',
        team: 'T',
        nextAction: 'Submit',
        notes: 'n',
      }),
    );
    let sheet = await openSheet(user, 'Old one');
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Status for Old one' }),
      'finished',
    );
    expect(await screen.findByText('Past · 1')).toBeInTheDocument();
    expect((await db.hackathons.toArray())[0]).toMatchObject({
      status: 'finished',
      problemStatement: 'PS 2',
      notes: 'n',
    });
    await user.keyboard('{Escape}');
    await user.click(screen.getByText('Past · 1'));
    sheet = await openSheet(user, 'Old one');
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Status for Old one' }),
      'active',
    );
    await vi.waitFor(() => expect(screen.queryByText(/^Past/)).not.toBeInTheDocument());
  });

  it('orders by the next meaningful date', async () => {
    await setup(async ({ hackathons }) => {
      await hackathons.create({ name: 'Later', eventStart: addDays(today(), 20) });
      await hackathons.create({ name: 'No date' });
      await hackathons.create({
        name: 'Registration soon',
        registrationDeadline: addDays(today(), 2),
        eventStart: addDays(today(), 30),
      });
      await hackathons.create({ name: 'Sooner', eventStart: addDays(today(), 5) });
    });
    await screen.findByRole('heading', { level: 3, name: 'Later' });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Registration soon',
      'Sooner',
      'Later',
      'No date',
    ]);
  });

  it('surfaces a failed status change calmly', async () => {
    const db = newDb();
    const base = createDexieRepositories(db);
    await base.hackathons.create({ name: 'Sticky' });
    const repositories = {
      ...base,
      hackathons: { ...base.hackathons, update: vi.fn().mockRejectedValue(new Error('x')) },
    };
    const { user } = await renderApp('/hackathons', repositories);
    const sheet = await openSheet(user, 'Sticky');
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Build for Sticky' }),
      'submitted',
    );
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Couldn’t save that');
  });
});

describe('Hackathons on Today', () => {
  it('shows only near-term relevant hackathons, once each, with the next action', async () => {
    const { user } = await setup(async ({ hackathons }) => {
      await hackathons.create({
        name: 'LinkedIn AI Hackathon',
        registrationDeadline: addDays(today(), 1),
        eventStart: addDays(today(), 4),
        nextAction: 'Register team',
      });
      await hackathons.create({ name: 'Far away', eventStart: addDays(today(), 30) });
      await hackathons.create({ name: 'Done already', eventStart: today(), status: 'finished' });
    }, '/today');
    const section = await screen.findByRole('region', { name: 'Hackathons' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    const row = within(section).getByRole('listitem');
    expect(within(row).getByRole('link', { name: 'LinkedIn AI Hackathon' })).toHaveAttribute(
      'href',
      '/hackathons',
    );
    expect(row).toHaveTextContent(
      'Registration due tomorrow · Starts in 4 days · Next: Register team',
    );
    expect(screen.queryByText('Far away')).not.toBeInTheDocument();
    expect(screen.queryByText('Done already')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();

    await user.click(within(row).getByRole('link', { name: 'LinkedIn AI Hackathon' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Hackathons' }),
    ).toBeInTheDocument();
  });

  it('is absent when nothing is relevant, and caps at three with a link', async () => {
    await setup(
      (r) => r.hackathons.create({ name: 'Far', eventStart: addDays(today(), 9) }),
      '/today',
    );
    await screen.findByRole('heading', { name: 'Needs attention' });
    expect(screen.queryByRole('region', { name: 'Hackathons' })).not.toBeInTheDocument();
  });

  it('caps at three rows and links to the rest', async () => {
    await setup(async ({ hackathons }) => {
      for (const n of [1, 2, 3, 4])
        await hackathons.create({ name: `H${n}`, eventStart: addDays(today(), n) });
    }, '/today');
    const section = await screen.findByRole('region', { name: 'Hackathons' });
    expect(
      within(section)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('a')?.textContent),
    ).toEqual(['H1', 'H2', 'H3']);
    expect(
      within(section).getByRole('link', { name: 'See all hackathons (1 more coming up)' }),
    ).toBeInTheDocument();
  });
});
