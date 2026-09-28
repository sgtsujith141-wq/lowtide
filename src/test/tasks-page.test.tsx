import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { deadlineFromLocalDate, toLocalDate } from '../lib/time';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(
  seed?: (r: Repositories) => Promise<unknown>,
  override?: (r: Repositories) => Repositories,
) {
  const base = createDexieRepositories(newDb());
  await seed?.(base);
  const repositories = override ? override(base) : base;
  const rendered = renderApp('/tasks', repositories);
  await screen.findByRole('heading', { name: /^Open/ });
  return { repositories, ...rendered };
}

const openList = () => screen.getByRole('region', { name: /^Open/ });
const titleInput = () => screen.getByRole('textbox', { name: 'New task' });

describe('Tasks page', () => {
  it('creates a task from the title alone with Enter', async () => {
    const { user, repositories } = await setup();
    expect(await screen.findByText(/No open tasks/)).toBeInTheDocument();

    await user.type(titleInput(), 'Renew passport{Enter}');

    expect(await within(openList()).findByText('Renew passport')).toBeInTheDocument();
    expect(titleInput()).toHaveValue('');
    expect(titleInput()).toHaveFocus();
    expect((await repositories.tasks.listOpen())[0]).toMatchObject({
      title: 'Renew passport',
      priority: 'normal',
    });
  });

  it('creates a task with notes, priority, deadline and project', async () => {
    const { user, repositories } = await setup();
    await user.click(screen.getByRole('button', { name: 'Details' }));
    await user.type(titleInput(), 'Submit PPT');
    await user.type(screen.getByLabelText('Notes'), 'slides 1-10');
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    await user.type(screen.getByLabelText('Deadline'), '2031-05-04');
    await user.type(screen.getByLabelText('Project'), 'Hack Week');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const row = (await within(openList()).findByText('Submit PPT')).closest('li')!;
    expect(within(row).getByText('slides 1-10')).toBeInTheDocument();
    expect(within(row).getByText('Due 4 May 2031')).toBeInTheDocument();
    expect(within(row).getByText('Hack Week')).toBeInTheDocument();
    expect(within(row).getByText('High priority')).toBeInTheDocument();
    expect((await repositories.tasks.listOpen())[0]).toMatchObject({
      notes: 'slides 1-10',
      priority: 'high',
      project: 'Hack Week',
      dueAt: '2031-05-04T12:00:00.000Z',
    });
  });

  it('refuses an empty title with an associated error and saves nothing', async () => {
    const { user, repositories } = await setup();
    await user.type(titleInput(), '   {Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the task a title first.');
    expect(titleInput()).toHaveAttribute('aria-invalid', 'true');
    expect(titleInput()).toHaveAccessibleDescription('Give the task a title first.');
    expect(await repositories.tasks.listOpen()).toEqual([]);
  });

  it('keeps what was typed when creating fails', async () => {
    const { user } = await setup(undefined, (r) => ({
      ...r,
      tasks: { ...r.tasks, create: vi.fn().mockRejectedValue(new Error('QuotaExceededError')) },
    }));
    await user.type(titleInput(), 'Important{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the task');
    expect(titleInput()).toHaveValue('Important');
  });

  it('edits a task inline, including clearing its deadline', async () => {
    const { user, repositories } = await setup((r) =>
      r.tasks.create({ title: 'Old title', dueAt: deadlineFromLocalDate('2031-01-02') }),
    );
    await user.click(await screen.findByRole('button', { name: 'Edit: Old title' }));
    const form = screen.getByRole('form', { name: 'Edit task: Old title' });
    expect(within(form).getByLabelText('Deadline')).toHaveValue('2031-01-02');

    await user.clear(within(form).getByLabelText('Title'));
    await user.type(within(form).getByLabelText('Title'), 'New title');
    await user.clear(within(form).getByLabelText('Deadline'));
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await within(openList()).findByText('New title')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /Edit task/ })).not.toBeInTheDocument();
    const [task] = await repositories.tasks.listOpen();
    expect(task?.title).toBe('New title');
    expect(task).not.toHaveProperty('dueAt');
  });

  it('cancels editing with Escape without saving', async () => {
    const { user, repositories } = await setup((r) => r.tasks.create({ title: 'Stay' }));
    await user.click(await screen.findByRole('button', { name: 'Edit: Stay' }));
    await user.type(screen.getByLabelText('Title'), ' changed');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: /Edit task/ })).not.toBeInTheDocument();
    expect((await repositories.tasks.listOpen())[0]?.title).toBe('Stay');
  });

  it('refuses to save an edit with an empty title', async () => {
    const { user } = await setup((r) => r.tasks.create({ title: 'Named' }));
    await user.click(await screen.findByRole('button', { name: 'Edit: Named' }));
    await user.clear(screen.getByLabelText('Title'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A task needs a title.');
  });

  it('completes a task into Finished and reopens it', async () => {
    const { user, repositories } = await setup((r) => r.tasks.create({ title: 'Laundry' }));
    await user.click(await screen.findByRole('button', { name: 'Complete: Laundry' }));

    await vi.waitFor(() =>
      expect(within(openList()).queryByText('Laundry')).not.toBeInTheDocument(),
    );
    await user.click(screen.getByText('Finished · 1'));
    const finished = screen.getByText('Laundry').closest('li')!;
    expect(within(finished).getByText(/Done/)).toBeInTheDocument();
    expect(await repositories.tasks.listOpen()).toEqual([]);

    await user.click(within(finished).getByRole('button', { name: 'Reopen: Laundry' }));
    expect(await within(openList()).findByText('Laundry')).toBeInTheDocument();
  });

  it('drops a task but keeps it under Finished', async () => {
    const { user, repositories } = await setup((r) => r.tasks.create({ title: 'Side quest' }));
    await user.click(await screen.findByRole('button', { name: 'Drop: Side quest' }));
    await user.click(await screen.findByText('Finished · 1'));
    const row = screen.getByText('Side quest').closest('li')!;
    expect(within(row).getByText(/Dropped/)).toBeInTheDocument();
    const all = await new Promise<unknown[]>((resolve) => {
      const stop = repositories.tasks.watchClosed((list) => {
        stop();
        resolve(list);
      });
    });
    expect(all).toHaveLength(1);
  });

  it('surfaces a failed completion and leaves the task open', async () => {
    const { user } = await setup(
      (r) => r.tasks.create({ title: 'Stubborn' }),
      (r) => ({ ...r, tasks: { ...r.tasks, complete: vi.fn().mockRejectedValue(new Error('x')) } }),
    );
    await user.click(await screen.findByRole('button', { name: 'Complete: Stubborn' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t mark that task done');
    expect(within(openList()).getByText('Stubborn')).toBeInTheDocument();
  });

  it('labels overdue and due-today deadlines in words, soonest first', async () => {
    const today = toLocalDate(new Date());
    const yesterday = toLocalDate(new Date(Date.now() - 86_400_000));
    await setup(async (r) => {
      await r.tasks.create({ title: 'Someday' });
      await r.tasks.create({ title: 'Today one', dueAt: deadlineFromLocalDate(today) });
      await r.tasks.create({ title: 'Late one', dueAt: deadlineFromLocalDate(yesterday) });
    });
    await within(openList()).findByText('Someday');
    const titles = within(openList())
      .getAllByRole('listitem')
      .map((li) => li.querySelector('p')?.textContent);
    expect(titles).toEqual(['Late one', 'Today one', 'Someday']);
    expect(screen.getByText('Was due yesterday')).toBeInTheDocument();
    expect(screen.getByText('Due today')).toBeInTheDocument();
  });
});
