import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PreviewSheet, toPicked } from '@/features/media/components/PreviewSheet';
import { useSendMedia } from '@/features/media/use-send-media';
import { getUserDb } from '@/features/sync/local-db';
import { storeMedia, toPayload } from '@/features/sync/outbox-media';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { ME_ID } from '@/test/chat-fixtures';
import { offersViewOnce } from './rules';

vi.mock('@/features/media/process', async (original) => {
  const actual = await original<typeof import('@/features/media/process')>();
  return {
    ...actual,
    prepareFile: vi.fn(async (file: File, asDocument: boolean) => ({
      file,
      name: file.name,
      mime: file.type,
      kind: asDocument ? 'document' : actual.kindOf(file),
    })),
  };
});

const file = (name: string, type: string) => new File([new Uint8Array(4)], name, { type });
const png = () => file('a.png', 'image/png');

function sheet(files: File[], allowViewOnce = true) {
  const picked = toPicked(files);
  const onSend = vi.fn(async () => undefined);
  const view = render(
    <TooltipProvider>
      <PreviewSheet
        picked={picked}
        maxBytes={null}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSend={onSend}
        allowViewOnce={allowViewOnce}
      />
    </TooltipProvider>,
  );
  return { ...view, picked, onSend };
}

describe('the "View once" toggle', () => {
  it('is offered for one photo, off by default, and sends viewOnce when pressed', async () => {
    const user = userEvent.setup();
    const { onSend, picked } = sheet([png()]);
    const toggle = screen.getByRole('button', { name: 'View once' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Screenshots can’t be blocked in a browser.')).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ items: picked, asDocument: false, viewOnce: true });
  });

  it('is offered for one video', () => {
    sheet([file('clip.mp4', 'video/mp4')]);
    expect(screen.getByRole('button', { name: 'View once' })).toBeInTheDocument();
  });

  it('is not offered for several items, documents, voice, or in Saved Messages', async () => {
    const { unmount } = sheet([png(), file('b.png', 'image/png')]);
    expect(screen.queryByRole('button', { name: 'View once' })).toBeNull();
    unmount();
    sheet([file('q3.pdf', 'application/pdf')]).unmount();
    expect(screen.queryByRole('button', { name: 'View once' })).toBeNull();
    sheet([png()], false).unmount();
    expect(screen.queryByRole('button', { name: 'View once' })).toBeNull();
    const user = userEvent.setup();
    const { onSend, picked } = sheet([png()]);
    await user.click(screen.getByRole('button', { name: 'View once' }));
    await user.click(screen.getByRole('checkbox', { name: /Send as document/ }));
    expect(screen.queryByRole('button', { name: 'View once' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ items: picked, asDocument: true });
    expect(
      offersViewOnce({ files: [{ type: 'audio/webm' }], asDocument: false, allowed: true }),
    ).toBe(false);
  });
});

describe('sending view once', () => {
  it('passes the flag to the outbox for a single photo only', async () => {
    const sendMedia = vi.fn(async () => undefined);
    useSyncStore.setState({ client: { sendMedia } as never });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSendMedia('c1'), { wrapper });
    const [item] = toPicked([png()]);
    await act(() =>
      result.current.send({ items: item ? [item] : [], asDocument: false, viewOnce: true }),
    );
    expect(sendMedia).toHaveBeenLastCalledWith(expect.objectContaining({ viewOnce: true }));
    await act(() =>
      result.current.send({ items: toPicked([png(), png()]), asDocument: false, viewOnce: true }),
    );
    expect(sendMedia).toHaveBeenLastCalledWith(expect.not.objectContaining({ viewOnce: true }));
    useSyncStore.setState({ client: null });
  });

  it('keeps it on the outbox row and the pending message, and puts it on message:send', async () => {
    const db = getUserDb(ME_ID);
    await db.open();
    const clientMsgId = await storeMedia(
      db,
      ME_ID,
      {
        chatId: 'c1',
        caption: '',
        info: { kind: 'image', name: 'a.png', mime: 'image/png', size: 4 },
        file: png(),
        viewOnce: true,
      },
      async () => undefined,
    );
    const row = await db.outbox.where('clientMsgId').equals(clientMsgId).first();
    expect(row?.viewOnce).toBe(true);
    expect((await db.messages.get(`${ME_ID}:${clientMsgId}`))?.viewOnce).toBe(true);
    expect(row && toPayload({ ...row, mediaId: 'm1' })).toMatchObject({
      mediaIds: ['m1'],
      viewOnce: true,
    });
    expect(row && toPayload({ ...row, mediaId: 'm1', viewOnce: false })).not.toHaveProperty(
      'viewOnce',
    );
  });
});
