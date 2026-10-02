import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CompanionClient } from '../db/companion/client';
import type { AiChange } from '../db/companion/wire';
import { AiChanges, AiChangesBadge } from '../features/context/AiChanges';

const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function change(over: Partial<AiChange>): AiChange {
  return {
    id: crypto.randomUUID(),
    at: at(1),
    grantId: 'g1',
    client: 'Claude',
    tool: 'move_space_item',
    summary: 'Moved page “A” to Ideas',
    revertible: true,
    ...over,
  };
}

function fakeClient(list: AiChange[], revert: (id: string) => Promise<unknown>) {
  return {
    changes: vi.fn(async () => list),
    revertChange: vi.fn(revert),
    revertBatch: vi.fn(async () => []),
    onEvent: () => () => undefined,
  } as unknown as CompanionClient;
}

describe('What AI changed', () => {
  it('groups a bulk call, undoes it all at once, and shows why a single undo was refused', async () => {
    const batch = [
      change({ batchId: 'b1', summary: 'Archived page “Old 1”', at: at(2) }),
      change({ batchId: 'b1', summary: 'Archived page “Old 2”', at: at(2) }),
    ];
    const single = change({ summary: 'Renamed “Draft” to “Draft two”', at: at(1) });
    const client = fakeClient([single, ...batch], () =>
      Promise.reject(new Error('“Renamed …” can’t be undone: it changed after that.')),
    );
    const user = userEvent.setup();
    render(<AiChanges client={client} grants={[]} onShowAll={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'AI changes' });
    expect(within(list).getByText(/2 changes in one go/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Undo all 2' }));
    expect(client.revertBatch).toHaveBeenCalledWith('b1');
    await user.click(within(list).getByRole('button', { name: /^Undo: Renamed/ }));
    expect(await within(list).findByRole('alert')).toHaveTextContent('it changed after that');
  });

  it('shows one client’s changes when asked, and offers no undo for what can’t be undone', async () => {
    const client = fakeClient(
      [
        change({ grantId: 'g2', client: 'Other', summary: 'Added task “x”' }),
        change({ summary: 'Recorded decision “y”', revertible: false }),
      ],
      async () => [],
    );
    render(
      <AiChanges
        client={client}
        grants={[{ id: 'g1', label: 'Claude' } as never]}
        onlyGrant="g1"
        onShowAll={() => undefined}
      />,
    );
    const list = await screen.findByRole('list', { name: 'AI changes' });
    expect(within(list).queryByText(/Added task/)).not.toBeInTheDocument();
    expect(within(list).getByText(/Recorded decision/)).toBeInTheDocument();
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing changes by Claude/)).toBeInTheDocument();
  });

  it('badges the count since the last visit, and nothing before a first visit', async () => {
    localStorage.removeItem('lowtide.ai.lastVisit');
    const client = fakeClient([change({}), change({})], async () => []);
    const { container, unmount } = render(<AiChangesBadge client={client} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    localStorage.setItem('lowtide.ai.lastVisit', at(10));
    render(<AiChangesBadge client={client} />);
    expect(await screen.findByLabelText('2 AI changes since your last visit')).toHaveTextContent(
      '2',
    );
  });
});
