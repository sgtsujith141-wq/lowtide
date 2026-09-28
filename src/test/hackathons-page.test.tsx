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

const sheet = (name: string) => screen.getByRole('article', { name });

describe('Hackathons page', () => {
  it('starts calm and empty', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Hackathons' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing on the radar/)).toBeInTheDocument();
    expect(screen.queryByText(/%|score/i)).not.toBeInTheDocument();
  });

  it('adds a hackathon with just a name and a date, then focuses it', async () => {
    const { user, db, trap } = await setup();
    await user.click(screen.getByRole('button', { name: 'Add hackathon' }));
    const form = screen.getByRole('form', { name: 'Add hackathon' });
    expect(within(form).queryByLabelText('Problem statement')).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'Hackurity');
    await user.type(within(form).getByLabelText('Event starts'), addDays(today(), 4));
    await user.click(within(form).getByRole('button', { name: 'Add' }));

    const article = await screen.findByRole('article', { name: 'Hackurity' });
    expect(within(article).getByText('Starts in 4 days')).toBeInTheDocument();
    await expectFocus(() => within(article).getByRole('button', { name: 'Edit Hackurity' }));
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

  it('edits every field, including registration deadline, problem statement and team', async () => {
    const { user, db } = await setup((r) => r.hackathons.create({ name: 'AI Build Week' }));
    await user.click(await screen.findByRole('button', { name: 'Edit AI Build Week' }));
    const form = screen.getByRole('form', { name: 'Edit AI Build Week' });
    await user.type(within(form).getByLabelText('Registration deadline'), addDays(today(), 1));
    await user.type(within(form).getByLabelText('Event starts'), addDays(today(), 10));
    await user.type(within(form).getByLabelText('Event ends (optional)'), addDays(today(), 11));
    await user.type(within(form).getByLabelText('Problem statement'), 'PS 7: offline triage');
    await user.type(within(form).getByLabelText('Team'), 'Asha, Ravi');
    await user.type(within(form).getByLabelText('Next action'), 'Register team');
    await user.type(within(form).getByLabelText('Notes'), 'closes 11:59 pm');
    await user.selectOptions(within(form).getByLabelText('Status'), 'active');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const article = await screen.findByRole('article', { name: 'AI Build Week' });
    await expectFocus(() => within(article).getByRole('button', { name: 'Edit AI Build Week' }));
    expect(within(article).getByText('Registration due tomorrow')).toBeInTheDocument();
    expect(within(article).getByText('Register team')).toBeInTheDocument();
    await user.click(within(article).getByText('Problem statement, Team, Notes'));
    expect(within(article).getByText('PS 7: offline triage')).toBeInTheDocument();
    expect(within(article).getByText('Asha, Ravi')).toBeInTheDocument();
    expect((await db.hackathons.toArray())[0]).toMatchObject({
      registrationDeadline: addDays(today(), 1),
      eventStart: addDays(today(), 10),
      eventEnd: addDays(today(), 11),
      status: 'active',
      notes: 'closes 11:59 pm',
    });
  });

  it('updates registration, PPT and build from the sheet without an editor', async () => {
    const { user, db, trap } = await setup((r) => r.hackathons.create({ name: 'Hackurity' }));
    const article = await screen.findByRole('article', { name: 'Hackurity' });
    await user.selectOptions(
      within(article).getByRole('combobox', { name: 'Registration for Hackurity' }),
      'registered',
    );
    await user.selectOptions(
      within(article).getByRole('combobox', { name: 'PPT for Hackurity' }),
      'in_progress',
    );
    await user.selectOptions(
      within(article).getByRole('combobox', { name: 'Build for Hackurity' }),
      'demo_ready',
    );
    await vi.waitFor(async () =>
      expect((await db.hackathons.toArray())[0]).toMatchObject({
        registrationStatus: 'registered',
        pptStatus: 'in_progress',
        buildStatus: 'demo_ready',
      }),
    );
    expect(within(article).getByRole('combobox', { name: 'PPT for Hackurity' })).toHaveDisplayValue(
      'In progress',
    );
    // Controls stay enabled while saving, so keyboard focus isn't dropped.
    await expectFocus(() => within(article).getByRole('combobox', { name: 'Build for Hackurity' }));
    expect(within(article).getByRole('combobox', { name: 'Build for Hackurity' })).toBeEnabled();
    expect(await db.habitEntries.count()).toBe(0);
    expect(trap).not.toHaveBeenCalled();
  });

  it('adds and edits the next action in place; Escape cancels', async () => {
    const { user, db } = await setup((r) => r.hackathons.create({ name: 'Hackurity' }));
    await user.click(
      await screen.findByRole('button', { name: 'Add a next action for Hackurity' }),
    );
    await user.keyboard('Finish PPT outline{Enter}');
    const article = sheet('Hackurity');
    expect(await within(article).findByText('Finish PPT outline')).toBeInTheDocument();
    expect(within(article).getByText('Next:')).toBeInTheDocument();

    await user.click(
      within(article).getByRole('button', { name: 'Edit next action for Hackurity' }),
    );
    await user.keyboard('{Control>}a{/Control}ignored{Escape}');
    expect(within(article).getByText('Finish PPT outline')).toBeInTheDocument();
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
    const article = await screen.findByRole('article', { name: 'Old one' });
    await user.selectOptions(
      within(article).getByRole('combobox', { name: 'Status for Old one' }),
      'finished',
    );

    const past = await screen.findByText('Past · 1');
    await vi.waitFor(() => expect(past).toHaveFocus());
    expect(screen.getByText(/Nothing on the radar/)).toBeInTheDocument();
    expect((await db.hackathons.toArray())[0]).toMatchObject({
      status: 'finished',
      problemStatement: 'PS 2',
      team: 'T',
      nextAction: 'Submit',
      notes: 'n',
    });

    await user.click(past);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Status for Old one' }),
      'active',
    );
    await expectFocus(screen.findByRole('button', { name: 'Edit Old one' }));
    expect(screen.queryByText(/^Past/)).not.toBeInTheDocument();
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
    await screen.findByRole('article', { name: 'Later' });
    expect(
      screen
        .getAllByRole('article')
        .map(
          (a) => a.getAttribute('aria-labelledby') && within(a).getByRole('heading').textContent,
        ),
    ).toEqual(['Registration soon', 'Sooner', 'Later', 'No date']);
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
    const article = await screen.findByRole('article', { name: 'Sticky' });
    await user.selectOptions(
      within(article).getByRole('combobox', { name: 'Build for Sticky' }),
      'submitted',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that');
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
    }, '/');
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
    await setup((r) => r.hackathons.create({ name: 'Far', eventStart: addDays(today(), 9) }), '/');
    await screen.findByRole('heading', { name: 'Needs attention' });
    expect(screen.queryByRole('region', { name: 'Hackathons' })).not.toBeInTheDocument();
  });

  it('caps at three rows and links to the rest', async () => {
    await setup(async ({ hackathons }) => {
      for (const n of [1, 2, 3, 4])
        await hackathons.create({ name: `H${n}`, eventStart: addDays(today(), n) });
    }, '/');
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
