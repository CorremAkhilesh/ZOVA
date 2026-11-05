import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type ChatMessage, ME } from '@/features/chats/types';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { PreviewSheet, toPicked } from './components/PreviewSheet';
import { UploadNotice } from './components/UploadNotice';

const png = (name = 'a.png', size = 1000) => {
  const file = new File([new Uint8Array(1)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const GB = 1024 ** 3;

/** A file that says it is this large, without being it. */
function sized(name: string, size: number) {
  const file = new File(['x'], name, { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('notes under a message', () => {
  const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
    id: 'm1',
    chatId: 'c1',
    clientMsgId: 'cm1',
    text: '',
    at: new Date(),
    authorId: ME,
    authorName: 'Me',
    ...overrides,
  });

  it('tells the person to keep the tab open, only while it matters', () => {
    const { rerender } = render(
      <UploadNotice message={message({ status: 'pending', heldInTab: true })} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Keep this tab open until the upload finishes',
    );
    rerender(<UploadNotice message={message({ status: 'pending', heldInTab: false })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a retry, with the reason when there is one', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <UploadNotice
        message={message({ status: 'failed', failReason: 'diskFull' })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('low on storage');
    await user.click(screen.getByRole('button', { name: /Not sent/ }));
    expect(onRetry).toHaveBeenCalledWith('cm1');
  });

  it('offers a removal for a lost file, because a retry could never work', async () => {
    const user = userEvent.setup();
    const cancelMedia = vi.fn(async () => undefined);
    useSyncStore.setState({ client: { cancelMedia } as never });
    render(
      <UploadNotice
        message={message({ status: 'failed', failReason: 'fileLost' })}
        onRetry={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Tap to remove/ }));
    expect(cancelMedia).toHaveBeenCalledWith('cm1');
    expect(screen.queryByRole('button', { name: /Not sent/ })).not.toBeInTheDocument();
    useSyncStore.setState({ client: null });
  });
});

describe('preview sheet', () => {
  function setup(files: File[], maxBytes: number | null = GB) {
    const picked = toPicked(files);
    const onSend = vi.fn(async () => undefined);
    const onChange = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <TooltipProvider>
        <PreviewSheet
          picked={picked}
          maxBytes={maxBytes}
          onChange={onChange}
          onClose={onClose}
          onSend={onSend}
        />
      </TooltipProvider>,
    );
    return { ...view, picked, onSend, onChange, onClose };
  }

  it('shows the files and the total, and has no axe violations', async () => {
    setup([png('a.png', 1024), png('b.png', 2048)]);
    expect(await screen.findByRole('dialog', { name: 'Send 2 files' })).toBeInTheDocument();
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('Total: 3 KB')).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('removes an item, and sets a caption per item', async () => {
    const user = userEvent.setup();
    const { onChange, picked } = setup([png('a.png'), png('b.png')]);
    await user.click(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(onChange).toHaveBeenLastCalledWith([picked[1]]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Caption for b.png' }), {
      target: { value: 'Second' },
    });
    expect(onChange.mock.lastCall?.[0][1]).toMatchObject({ caption: 'Second' });
  });

  it('sends as a document when asked, and closes', async () => {
    const user = userEvent.setup();
    const { onSend, onClose, picked } = setup([png('a.png')]);
    await user.click(screen.getByRole('checkbox', { name: /Send as document/ }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ items: picked, asDocument: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open and says so when the files cannot be queued', async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onSend, onClose } = setup([png('a.png')]);
    onSend.mockRejectedValueOnce(new Error('storage refused'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t prepare these files');
    expect(onClose).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('leaves out a file over the limit, says so, and still shows its size', async () => {
    const user = userEvent.setup();
    const { onSend, picked } = setup([sized('huge.mp4', 2 * GB), png('fine.png', 1024)]);
    expect(screen.getByText(/Larger than the 1 GB limit/)).toBeInTheDocument();
    expect(screen.getByText(/^2 GB/)).toBeInTheDocument();
    expect(screen.getByText('Total: 1 KB')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Send 1 file' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({ items: [picked[1]], asDocument: false });
  });

  it('accepts a file exactly at the limit, and refuses one byte more', () => {
    const { unmount } = setup([sized('at.mp4', GB)]);
    expect(screen.queryByText(/Larger than/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    unmount();
    setup([sized('over.mp4', GB + 1)]);
    expect(screen.getByText(/Larger than the 1 GB limit/)).toBeInTheDocument();
  });

  it('says what the configured limit is', () => {
    setup([sized('a.mp4', 6 * 1024 * 1024)], 5 * 1024 * 1024);
    expect(screen.getByText(/Larger than the 5 MB limit/)).toBeInTheDocument();
  });

  it('has nothing to send when every file is too large', async () => {
    const { container, onSend } = setup([sized('a.mp4', 2 * GB), sized('b.mp4', 3 * GB)]);
    const button = screen.getByRole('button', { name: 'Nothing to send' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Nothing to send' })).toBeInTheDocument();
    expect(screen.queryByText(/Send 0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
  });

  it('refuses nothing while the limit is unknown', () => {
    setup([sized('a.mp4', 5 * GB)], null);
    expect(screen.queryByText(/Larger than/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('says when there are more files than can go at once', () => {
    setup(Array.from({ length: 31 }, (_, n) => png(`${n}.png`)));
    expect(screen.getByRole('alert')).toHaveTextContent('up to 30 files');
  });
});
