import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const composer = () => screen.getByRole('textbox', { name: 'What’s taking up space?' });

async function setup(override?: (repos: Repositories) => Repositories) {
  const db = newDb();
  const base = createDexieRepositories(db);
  const repositories = override ? override(base) : base;
  return { db, repositories, ...(await renderApp('/', repositories)) };
}

describe('Brain dump capture', () => {
  it('saves on Enter, clears, keeps focus, and the inbox link updates reactively', async () => {
    const { user, repositories } = await setup();
    await user.type(composer(), 'buy stamps{Enter}');

    expect(
      await screen.findByRole('link', { name: '1 thought waiting in your inbox' }),
    ).toHaveAttribute('href', '/inbox');
    expect(composer()).toHaveValue('');
    expect(composer()).toHaveFocus();
    expect((await repositories.inbox.listUnprocessed()).map((i) => i.content)).toEqual([
      'buy stamps',
    ]);

    await user.type(composer(), 'call the bank{Enter}');
    expect(
      await screen.findByRole('link', { name: '2 thoughts waiting in your inbox' }),
    ).toBeInTheDocument();
    expect(await repositories.inbox.countUnprocessed()).toBe(2);
  });

  it('inserts a newline on Shift+Enter without saving', async () => {
    const { user, repositories } = await setup();
    await user.type(composer(), 'first line{Shift>}{Enter}{/Shift}second line');
    expect(composer()).toHaveValue('first line\nsecond line');
    expect(await repositories.inbox.countUnprocessed()).toBe(0);

    await user.keyboard('{Enter}');
    await screen.findByRole('link', { name: /waiting in your inbox/ });
    expect((await repositories.inbox.listUnprocessed())[0]?.content).toBe(
      'first line\nsecond line',
    );
  });

  it('also saves on Cmd+Enter and Ctrl+Enter', async () => {
    const { user, repositories } = await setup();
    await user.type(composer(), 'one{Meta>}{Enter}{/Meta}');
    await user.type(composer(), 'two{Control>}{Enter}{/Control}');
    await vi.waitFor(async () => expect(await repositories.inbox.countUnprocessed()).toBe(2));
  });

  it('does nothing for whitespace-only input', async () => {
    const { user, repositories } = await setup();
    await user.type(composer(), '   {Enter}');
    expect(await repositories.inbox.countUnprocessed()).toBe(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not save while an IME composition is in progress', async () => {
    const { user, repositories } = await setup();
    await user.type(composer(), 'にほん');
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(composer(), { key: 'Enter', keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await repositories.inbox.countUnprocessed()).toBe(0);
    expect(composer()).toHaveValue('にほん');
  });

  it('keeps the draft and says so when saving fails, then saves on retry', async () => {
    const capture = vi.fn();
    const { user, repositories } = await setup((repos) => {
      capture
        .mockRejectedValueOnce(new Error('QuotaExceededError'))
        .mockImplementation(repos.inbox.capture);
      return { ...repos, inbox: { ...repos.inbox, capture } };
    });

    await user.type(composer(), 'do not lose this{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t save that');
    expect(alert).not.toHaveTextContent('QuotaExceededError');
    expect(composer()).toHaveValue('do not lose this');
    expect(composer()).toHaveAttribute('aria-invalid', 'true');
    expect(composer()).toHaveAccessibleDescription(/Couldn’t save that/);
    expect(composer()).toHaveFocus();

    await user.keyboard('{Enter}');
    // The box clears at once (ADR-017); the error goes only after the write
    // succeeds, so wait for that rather than assuming it's already done.
    await vi.waitFor(() => expect(composer()).toHaveValue(''));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect((await repositories.inbox.listUnprocessed()).map((i) => i.content)).toEqual([
      'do not lose this',
    ]);
  });

  it('keeps rapid captures separate and in order while saves are still in flight', async () => {
    const { user, repositories } = await setup((repos) => {
      const slow = async (text: string) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return repos.inbox.capture(text);
      };
      return { ...repos, inbox: { ...repos.inbox, capture: slow } };
    });

    await user.type(composer(), 'one{Enter}two{Enter}three{Enter}');
    expect(composer()).toHaveValue('');

    await vi.waitFor(async () =>
      expect((await repositories.inbox.listUnprocessed()).map((i) => i.content)).toEqual([
        'one',
        'two',
        'three',
      ]),
    );
    expect(composer()).toHaveValue('');
  });

  it('puts a failed thought back ahead of anything typed since', async () => {
    const capture = vi.fn();
    const { user } = await setup((repos) => {
      capture.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        throw new Error('disk full');
      });
      return { ...repos, inbox: { ...repos.inbox, capture } };
    });

    await user.type(composer(), 'lost?{Enter}still typing');
    await screen.findByRole('alert');
    expect(composer()).toHaveValue('lost?\nstill typing');
  });
});
