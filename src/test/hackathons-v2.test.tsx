import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, RecordStateError } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

describe('Hackathons in v2 (ADR-039, ADR-053)', () => {
  it('shows the seven stages from the sheet’s own statuses', async () => {
    const r = createDexieRepositories(newDb());
    await r.hackathons.create({
      name: 'Autumn hack',
      registrationStatus: 'registered',
      problemStatement: 'Smart irrigation',
      researchStatus: 'done',
      pptStatus: 'submitted',
      buildStatus: 'in_progress',
    });
    await renderApp('/hackathons', r);
    const stages = await screen.findByRole('list', { name: 'Stages for Autumn hack' });
    expect(
      within(stages)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Registration: done',
      'Problem: done',
      'Research: done',
      'PPT: done',
      'Prototype / build: in progress',
      'Testing: to do',
      'Submission: to do',
    ]);
  });

  it('never creates a project by itself, and links one only when asked', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    await r.hackathons.create({ name: 'Spring hack', problemStatement: 'Clean water' });
    const { user } = await renderApp('/hackathons', r);
    await screen.findByRole('article', { name: 'Spring hack' });
    expect(await db.projects.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Track the build as a project' }));
    const link = await screen.findByRole('link', { name: 'Spring hack' });
    expect(link).toHaveAttribute('href', '/projects/spring-hack');
    const [project] = await db.projects.toArray();
    expect(project).toMatchObject({
      name: 'Spring hack',
      objective: 'Clean water',
      state: 'active',
    });
    expect((await db.hackathons.toArray())[0]?.projectId).toBe(project!.id);

    await user.click(screen.getByRole('button', { name: 'Unlink' }));
    await vi.waitFor(async () =>
      expect((await db.hackathons.toArray())[0]).not.toHaveProperty('projectId'),
    );
    // Unlinking keeps the project and its history.
    expect(await db.projects.count()).toBe(1);
  });

  it('refuses to track the same hackathon twice', async () => {
    const r = createDexieRepositories(newDb());
    const h = await r.hackathons.create({ name: 'Once' });
    await r.projects.createFromHackathon(h.id);
    await expect(r.projects.createFromHackathon(h.id)).rejects.toBeInstanceOf(RecordStateError);
  });
});
