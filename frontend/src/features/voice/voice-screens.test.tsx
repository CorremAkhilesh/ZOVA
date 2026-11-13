import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaInfo } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChatMessage, ME } from '@/features/chats/types';
import { previewText } from '@/features/chats/view';
import { kindOf } from '@/features/media/process';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { AudioBubble } from './components/AudioBubble';
import { MiniPlayer } from './components/MiniPlayer';
import { VoiceBubble } from './components/VoiceBubble';
import { nextPosition } from './components/Waveform';
import { playTrack, resetPlayerForTests, usePlayer } from './player';

const media = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  id: 'v1',
  kind: 'voice',
  mime: 'audio/webm',
  size: 2048,
  name: 'voice-note.webm',
  width: null,
  height: null,
  duration: 12.4,
  waveform: Array.from({ length: 64 }, (_unused, bar) => (bar * 3) % 100),
  placeholder: null,
  hasThumbnail: false,
  ...overrides,
});
const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'key-1',
  serverId: 'm1',
  chatId: 'c1',
  clientMsgId: 'cm1',
  authorId: 'u-asha',
  authorName: 'Asha',
  text: '',
  at: new Date('2026-11-05T10:00:00Z'),
  status: 'sent',
  played: false,
  media: media(),
  ...overrides,
});

beforeEach(() => {
  resetPlayerForTests();
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  server.use(
    http.get('*/v1/media/:id/link', () =>
      HttpResponse.json({
        url: '/v1/media/v1/content?sig=1',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }),
    ),
  );
});
afterEach(() => {
  resetPlayerForTests();
  vi.restoreAllMocks();
});

describe('a voice bubble', () => {
  it('shows length and shape, with an unplayed dot for the receiver', async () => {
    const { container } = render(<VoiceBubble message={message()} />);
    expect(screen.getByText('0:12')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Position' })).toBeInTheDocument();
    expect(container.querySelectorAll('[role="slider"] span')).toHaveLength(64);
    expect(screen.getByRole('img', { name: 'Not played yet' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no dot once played, or on my own note', () => {
    const { rerender } = render(<VoiceBubble message={message({ played: true })} />);
    expect(screen.queryByRole('img', { name: 'Not played yet' })).not.toBeInTheDocument();
    rerender(<VoiceBubble message={message({ authorId: ME })} />);
    expect(screen.queryByRole('img', { name: 'Not played yet' })).not.toBeInTheDocument();
  });

  it('plays, shows elapsed time, then offers the speed', async () => {
    const user = userEvent.setup();
    render(<VoiceBubble message={message()} />);
    await user.click(screen.getByRole('button', { name: 'Play voice message' }));
    expect(usePlayer.getState().track?.key).toBe('key-1');
    expect(screen.getByText('0:00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Speed 1x/ }));
    expect(usePlayer.getState().speed).toBe(1.5);
  });

  it('can be seeked and played with the keyboard', async () => {
    const user = userEvent.setup();
    render(<VoiceBubble message={message()} />);
    const slider = screen.getByRole('slider', { name: 'Position' });
    slider.focus();
    await user.keyboard(' ');
    expect(usePlayer.getState().track?.key).toBe('key-1');
    await user.keyboard('{ArrowRight}');
    expect(usePlayer.getState().position).toBe(5);
    await user.keyboard('{ArrowLeft}');
    expect(usePlayer.getState().position).toBe(0);
    await user.keyboard('{End}');
    expect(usePlayer.getState().position).toBe(12.4);
    await user.keyboard('{Home}');
    expect(usePlayer.getState().position).toBe(0);
  });

  it('tapping the waveform starts from there', () => {
    render(<VoiceBubble message={message()} />);
    const slider = screen.getByRole('slider', { name: 'Position' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
    expect(usePlayer.getState().track?.key).toBe('key-1');
    expect(usePlayer.getState().position).toBeCloseTo(6.2);
  });

  it('says so when this device cannot play it, instead of doing nothing', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    const user = userEvent.setup();
    render(<VoiceBubble message={message()} />);
    await user.click(screen.getByRole('button', { name: 'Play voice message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t play this recording');
  });

  it('shows the upload ring while it is still uploading', () => {
    render(
      <VoiceBubble
        message={message({
          authorId: ME,
          status: 'pending',
          media: media({ id: '' }),
          uploadedBytes: 1,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: /Cancel upload/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Position' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('survives a note with no waveform', () => {
    render(<VoiceBubble message={message({ media: media({ waveform: null }) })} />);
    expect(screen.getByRole('slider', { name: 'Position' })).toBeInTheDocument();
  });
});

describe('moving through a note with the keyboard', () => {
  it('stays inside it', () => {
    expect(nextPosition('ArrowRight', 98, 100)).toBe(100);
    expect(nextPosition('ArrowLeft', 2, 100)).toBe(0);
    expect(nextPosition('ArrowUp', 10, 100)).toBe(15);
    expect(nextPosition('ArrowDown', 10, 100)).toBe(5);
    expect(nextPosition('a', 10, 100)).toBeNull();
  });
});

describe('an attached audio file', () => {
  const file = () =>
    message({
      media: media({
        id: 'f1',
        kind: 'audio',
        mime: 'audio/mpeg',
        name: 'song.mp3',
        waveform: null,
        duration: null,
      }),
    });

  it('has a plain player with name, size and download: no waveform or dot', async () => {
    const { container } = render(<AudioBubble message={file()} />);
    expect(screen.getByText('song.mp3')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download song.mp3' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Not played yet' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('plays and offers the speed', async () => {
    const user = userEvent.setup();
    render(<AudioBubble message={file()} />);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(usePlayer.getState().track).toMatchObject({ kind: 'audio', reportPlay: false });
    expect(screen.getByRole('button', { name: /Speed/ })).toBeInTheDocument();
  });

  it('is told apart from documents by type', () => {
    for (const type of ['audio/mpeg', 'audio/x-m4a', 'audio/wav', 'audio/ogg']) {
      expect(kindOf({ type })).toBe('audio');
    }
    expect(kindOf({ type: 'audio/x-unknown' })).toBe('document');
    expect(kindOf({ type: 'application/pdf' })).toBe('document');
  });
});

describe('the chat list', () => {
  it('says how long a voice note is', () => {
    const labels = { photo: 'Photo', video: 'Video', voice: 'Voice message' };
    expect(previewText({ type: 'voice', preview: '0:12' }, labels)).toBe('🎤 Voice message (0:12)');
    expect(previewText({ type: 'audio', preview: 'song.mp3' }, labels)).toBe('🎵 song.mp3');
  });
});

describe('the mini player', () => {
  it('appears while something is playing, and can pause and close', async () => {
    const user = userEvent.setup();
    const { container } = render(<MiniPlayer />);
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument();
    act(() => {
      playTrack({
        mediaId: 'v1',
        key: 'key-1',
        messageId: 'm1',
        chatId: 'c1',
        kind: 'voice',
        mime: 'audio/webm',
        title: 'Asha',
        subtitle: 'Voice message',
        duration: 12,
        reportPlay: false,
      });
    });
    expect(await screen.findByRole('region', { name: 'Now playing' })).toHaveTextContent('Asha');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Close player' }));
    expect(usePlayer.getState().track).toBeNull();
  });
});
