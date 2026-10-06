import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

describe('CTFs and selection on the Hackathons page (ADR-072)', () => {
  it('shows a CTF with its own short rail and no build to track', async () => {
    const r = createDexieRepositories(newDb());
    await r.hackathons.create({
      name: 'Night CTF',
      kind: 'ctf',
      registrationStatus: 'registered',
      researchStatus: 'in_progress',
      pptStatus: 'not_needed',
    });
    const { user } = await renderApp('/hackathons', r);
    const stages = await screen.findByRole('list', { name: 'Stages for Night CTF' });
    expect(
      within(stages)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Registration: done', 'Preparation: in progress', 'Competition: to do']);
    expect(screen.getByText('CTF')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Night CTF' }));
    const sheet = await screen.findByRole('dialog', { name: 'Night CTF' });
    expect(within(sheet).getByRole('combobox', { name: 'Preparation for Night CTF' })).toHaveValue(
      'in_progress',
    );
    expect(within(sheet).queryByRole('combobox', { name: 'PPT for Night CTF' })).toBeNull();
    expect(within(sheet).queryByRole('combobox', { name: 'Build for Night CTF' })).toBeNull();
    expect(
      within(sheet).queryByRole('button', { name: 'Track the build as a project' }),
    ).toBeNull();
  });

  it('records the organisers’ answer from the sheet and shows it in the list', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    await r.hackathons.create({ name: 'Build week', registrationStatus: 'registered' });
    const { user } = await renderApp('/hackathons', r);
    await user.click(await screen.findByRole('button', { name: 'Open Build week' }));
    const sheet = await screen.findByRole('dialog', { name: 'Build week' });
    const selection = within(sheet).getByRole('combobox', { name: 'Selection for Build week' });
    expect(selection).toHaveValue('');
    expect(within(sheet).getByRole('combobox', { name: 'PPT for Build week' })).toBeInTheDocument();

    await user.selectOptions(selection, 'Shortlisted');
    await vi.waitFor(async () =>
      expect((await db.hackathons.toArray())[0]?.selection).toBe('shortlisted'),
    );
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Selection for Build week' }),
      'Nothing yet',
    );
    await vi.waitFor(async () =>
      expect((await db.hackathons.toArray())[0]).not.toHaveProperty('selection'),
    );
  });

  it('turns a hackathon into a CTF from the edit form', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    await r.hackathons.create({ name: 'Weekend event', problemStatement: 'Web, crypto' });
    const { user } = await renderApp('/hackathons', r);
    await user.click(await screen.findByRole('button', { name: 'Open Weekend event' }));
    const sheet = await screen.findByRole('dialog', { name: 'Weekend event' });
    await user.click(within(sheet).getByRole('button', { name: 'Edit Weekend event' }));
    const form = await screen.findByRole('form', { name: 'Edit Weekend event' });
    await user.selectOptions(within(form).getByLabelText('Kind'), 'CTF');
    await user.selectOptions(within(form).getByLabelText('Selection'), 'Application submitted');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await vi.waitFor(async () =>
      expect((await db.hackathons.toArray())[0]).toMatchObject({
        kind: 'ctf',
        selection: 'applied',
        problemStatement: 'Web, crypto',
      }),
    );
    const stages = await screen.findByRole('list', { name: 'Stages for Weekend event' });
    expect(within(stages).getAllByRole('listitem')).toHaveLength(3);
  });
});
