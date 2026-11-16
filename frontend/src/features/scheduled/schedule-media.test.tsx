import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaInfo } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MediaApi, mediaApi } from '@/features/media/api';
import { PreviewSheet, toPicked } from '@/features/media/components/PreviewSheet';
import { RecordingBar } from '@/features/voice/components/RecordingBar';
import { axe } from '@/test/axe';
import ScheduledSheet from './components/ScheduledSheet';
import { scheduledPreview } from './preview';
import { scheduleMedia } from './schedule-media';
import { fixZone, renderAlone, scheduledFixture, serveScheduled } from './test-server';

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T04:30:00.000Z'));
  fixZone('Asia/Kolkata');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const info = (overrides: Partial<MediaInfo>): MediaInfo => ({
  id: 'm1',
  kind: 'image',
  name: 'beach.jpg',
  mime: 'image/jpeg',
  size: 10,
  width: null,
  height: null,
  duration: null,
  placeholder: null,
  hasThumbnail: false,
  ...overrides,
});

/** The upload API in memory: every file is accepted in one chunk. */
function fakeUploads() {
  const created: string[] = [];
  const api: MediaApi = {
    ...mediaApi,
    create: async (body) => {
      created.push(body.name);
      return { uploadId: `u${created.length}`, offset: 0, size: body.size, status: 'pending' };
    },
    setPoster: async () => ({ ok: true as const }),
    sendChunk: async (_id, offset, chunk) => offset + chunk.size,
    complete: async (id) => info({ id: `media-${id}` }),
  };
  return { api, created };
}

describe('what the scheduled list says about a file', () => {
  it('photo, video, document, voice note', () => {
    expect(scheduledPreview({ text: 'the view', media: info({}) })).toBe('📷 the view');
    expect(scheduledPreview({ text: null, media: info({ kind: 'video' }) })).toBe('🎥 Video');
    expect(
      scheduledPreview({ text: 'see p. 2', media: info({ kind: 'document', name: 'plan.pdf' }) }),
    ).toBe('📄 plan.pdf · see p. 2');
    expect(scheduledPreview({ text: null, media: info({ kind: 'voice', duration: 12 }) })).toBe(
      '🎤 Voice message (0:12)',
    );
    expect(scheduledPreview({ text: 'Hi', media: null })).toBe('Hi');
  });
});

describe('scheduleMedia', () => {
  it('uploads every file first, then schedules one message per file with its caption', async () => {
    const state = serveScheduled([]);
    const { api, created } = fakeUploads();
    const progress: number[] = [];
    const at = new Date('2026-11-13T03:30:00.000Z');
    const file = (size: number) => new Blob([new Uint8Array(size)]);
    await scheduleMedia(
      'c1',
      [
        {
          file: file(4),
          info: { kind: 'image', name: 'a.jpg', mime: 'image/jpeg', size: 4 },
          caption: ' first ',
        },
        {
          file: file(6),
          info: { kind: 'document', name: 'b.pdf', mime: 'application/pdf', size: 6 },
          caption: '',
        },
      ],
      at,
      (fraction) => progress.push(fraction),
      api,
    );
    expect(created).toEqual(['a.jpg', 'b.pdf']);
    expect(progress.at(-1)).toBe(1);
    const posted = state.requests.filter((request) => request.method === 'POST');
    expect(posted.map((request) => request.body)).toEqual([
      { chatId: 'c1', mediaId: 'media-u1', sendAt: at.toISOString(), text: 'first' },
      { chatId: 'c1', mediaId: 'media-u2', sendAt: at.toISOString() },
    ]);
  });
});

describe('Schedule from the preview sheet', () => {
  it('right click on Send offers it; the files and captions go at the picked time', async () => {
    const user = userEvent.setup();
    const onSchedule = vi.fn(async () => {});
    const onClose = vi.fn();
    const picked = toPicked([new File(['x'], 'beach.png', { type: 'image/png' })]).map((item) => ({
      ...item,
      caption: 'the view',
    }));
    renderAlone(
      <PreviewSheet
        picked={picked}
        maxBytes={null}
        onChange={() => {}}
        onClose={onClose}
        onSend={async () => {}}
        onSchedule={onSchedule}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Schedule message' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' });
    expect(dialog).toHaveTextContent('📷 the view');
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: /Tomorrow 9 AM/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSchedule).toHaveBeenCalledWith(
      { items: picked, asDocument: false },
      new Date('2026-11-13T03:30:00.000Z'),
      expect.any(Function),
    );
  });

  it('shows why when the upload or the schedule fails, and keeps the sheet open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderAlone(
      <PreviewSheet
        picked={toPicked([new File(['x'], 'plan.pdf', { type: 'application/pdf' })])}
        maxBytes={null}
        onChange={() => {}}
        onClose={onClose}
        onSend={async () => {}}
        onSchedule={async () => {
          throw new Error('no');
        }}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Schedule message' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' });
    expect(dialog).toHaveTextContent('📄 plan.pdf');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t save that');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Schedule from the voice recorder', () => {
  it('right click on Send offers it; a plain click still sends', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onSchedule = vi.fn();
    renderAlone(
      <RecordingBar
        status="recording"
        locked
        elapsedMs={5000}
        maxMs={900_000}
        levels={[]}
        onCancel={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onSend={onSend}
        onSchedule={onSchedule}
      />,
    );
    const send = screen.getByRole('button', { name: 'Send voice message' });
    fireEvent.contextMenu(send);
    await user.click(await screen.findByRole('button', { name: 'Schedule message' }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('the scheduled list', () => {
  it('shows files and voice notes in this chat', async () => {
    serveScheduled([
      scheduledFixture({ id: 's1', text: null, media: info({ kind: 'voice', duration: 75 }) }),
      scheduledFixture({ id: 's2', text: 'the view', media: info({}) }),
    ]);
    renderAlone(<ScheduledSheet chatId="c1" onClose={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Scheduled messages' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('🎤 Voice message (1:15)');
    expect(rows[1]).toHaveTextContent('📷 the view');
  });
});
