import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';

const messages = () => within(screen.getByRole('list', { name: 'Product & Design' }));
/** Sender name labels (reply quotes also show names, but without a sender color). */
const senderLabels = (name: string) =>
  messages()
    .getAllByText(name)
    .filter((element) => /text-sender[1-8]/.test(element.className));
/** The message bubble itself, not a reply quote that repeats its text. */
const bubbleItem = (text: string) => messages().getAllByText(text)[0]?.closest('li');

describe('group conversation rendering', () => {
  it('shows each sender name once per group, colored per sender', async () => {
    await renderApp('/chats/design-team', { width: DESKTOP_WIDTH });
    // Riya sends 3 messages within 2 minutes → one group → her name appears once there.
    // Two Riya groups in the thread (34–32 min ago, and 4 min ago).
    expect(senderLabels('Riya Sen')).toHaveLength(2);
    expect(senderLabels('Vikram Rao')).toHaveLength(1);
    // Same sender, same color; different senders use their own stable color.
    const [riyaA, riyaB] = senderLabels('Riya Sen');
    expect(riyaA?.className).toBe(riyaB?.className);
  });

  it('puts the tail and the avatar only on the last bubble of a group', async () => {
    await renderApp('/chats/design-team', { width: DESKTOP_WIDTH });
    const firstOfGroup = bubbleItem('Dark mode looks so much calmer now.');
    const lastOfGroup = bubbleItem('One question: should muted chats sink to the bottom?');
    if (!firstOfGroup || !lastOfGroup) throw new Error('bubbles not found');
    expect(within(firstOfGroup).queryByTestId('bubble-tail')).not.toBeInTheDocument();
    expect(within(firstOfGroup).queryByText('RS')).not.toBeInTheDocument();
    expect(within(lastOfGroup).getByTestId('bubble-tail')).toBeInTheDocument();
    expect(within(lastOfGroup).getByText('RS')).toBeInTheDocument();
  });

  it('shows no sender names or avatars in 1:1 chats', async () => {
    await renderApp('/chats/asha', { width: DESKTOP_WIDTH });
    const list = screen.getByRole('list', { name: 'Asha Verma' });
    expect(list.querySelectorAll('[class*="text-sender"]')).toHaveLength(0);
    expect(within(list).queryByText('AV')).not.toBeInTheDocument();
  });
});
