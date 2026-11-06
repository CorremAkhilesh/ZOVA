import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AWAY_AFTER_MS, trackAway } from '@/features/sync/away';
import { setTyping, TYPING_FALLBACK_MS, useLiveStatus } from '@/features/sync/live-status';
import { PresenceWatchList } from '@/features/sync/presence-watch';
import { i18n } from '@/lib/i18n';
import { axe } from '@/test/axe';
import { DeliveryTicks } from './components/DeliveryTicks';
import { formatLastSeen, statusLine } from './status-line';
import { tickState } from './ticks';
import { TYPING_IDLE_MS, TYPING_REFRESH_MS, TypingSender } from './typing-sender';

describe('tick state', () => {
  const chat = (peerDeliveredSeq: number, peerReadSeq: number, type = 'direct' as const) => ({
    type,
    peerDeliveredSeq,
    peerReadSeq,
  });
  const sent = (seq: number | null) => ({ status: 'sent' as const, seq });

  it.each([
    ['pending', { status: 'pending' as const, seq: null }, chat(9, 9)],
    ['failed', { status: 'failed' as const, seq: null }, chat(9, 9)],
    ['sent', sent(5), chat(4, 3)],
    ['delivered', sent(5), chat(5, 3)],
    ['delivered', sent(5), chat(8, 4)],
    ['read', sent(5), chat(5, 5)],
    ['read', sent(5), chat(8, 8)],
  ])('is %s', (expected, message, progress) => {
    expect(tickState(message, progress)).toBe(expected);
  });

  it('stays at one tick in Saved Messages', () => {
    expect(tickState(sent(5), { type: 'self', peerDeliveredSeq: 9, peerReadSeq: 9 })).toBe('sent');
  });

  it('handles chats stored before these fields existed', () => {
    const old = { type: 'direct' } as Parameters<typeof tickState>[1];
    expect(tickState(sent(5), old)).toBe('sent');
  });

  it.each(['pending', 'sent', 'delivered', 'read', 'failed'] as const)(
    'the %s icon has a name and respects reduced motion',
    async (status) => {
      const { container } = render(<DeliveryTicks status={status} />);
      const icon = container.querySelector('svg');
      expect(icon).toHaveAttribute('aria-label');
      expect(icon?.getAttribute('class')).toContain('motion-reduce:animate-none');
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});

describe('status line', () => {
  const now = new Date(2026, 10, 5, 15, 0);
  const t = i18n.t.bind(i18n);

  it.each([
    [new Date(2026, 10, 5, 8, 56), 'last seen today at 8:56 AM'],
    [new Date(2026, 10, 4, 20, 5), 'last seen yesterday at 8:05 PM'],
    [new Date(2026, 9, 12, 9, 0), 'last seen Oct 12'],
    [new Date(2025, 9, 12, 9, 0), 'last seen Oct 12, 2025'],
  ])('formats %s', (at, expected) => {
    expect(formatLastSeen(at, now, 'en-US', t)).toBe(expected);
  });

  it('puts the day first in a day-first locale', () => {
    expect(formatLastSeen(new Date(2026, 9, 12), now, 'en-GB', t)).toBe('last seen 12 Oct');
  });

  it('speaks Hindi', async () => {
    await i18n.changeLanguage('hi');
    const hindi = i18n.t.bind(i18n);
    expect(formatLastSeen(new Date(2026, 10, 5, 8, 56), now, 'hi', hindi)).toContain('आज');
    expect(formatLastSeen(new Date(2026, 10, 4, 8, 56), now, 'hi', hindi)).toContain('कल');
    expect(
      statusLine({ typing: false, presence: { online: true, lastSeenAt: null } }, now, 'hi', hindi),
    ).toBe('ऑनलाइन');
    expect(statusLine({ typing: true, presence: undefined }, now, 'hi', hindi)).toContain('टाइप');
  });

  it('prefers typing, then online, then last seen, and says nothing when hidden', () => {
    const online = { online: true, lastSeenAt: null };
    const away = { online: false, lastSeenAt: new Date(2026, 10, 5, 8, 0).toISOString() };
    const hidden = { online: false, lastSeenAt: null };
    expect(statusLine({ typing: true, presence: online }, now, 'en-US', t)).toBe('typing…');
    expect(statusLine({ typing: false, presence: online }, now, 'en-US', t)).toBe('online');
    expect(statusLine({ typing: false, presence: away }, now, 'en-US', t)).toContain('8:00 AM');
    expect(statusLine({ typing: false, presence: hidden }, now, 'en-US', t)).toBe('');
    expect(statusLine({ typing: false, presence: undefined }, now, 'en-US', t)).toBe('');
  });
});

describe('typing sender', () => {
  const setup = () => {
    vi.useFakeTimers();
    const sent: boolean[] = [];
    return { sent, sender: new TypingSender((typing) => sent.push(typing)) };
  };

  it('announces once, then at most every 3 seconds however fast the keys', () => {
    const { sent, sender } = setup();
    sender.input(true);
    for (let n = 0; n < 5; n++) {
      vi.advanceTimersByTime(TYPING_REFRESH_MS / 6);
      sender.input(true);
    }
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(TYPING_REFRESH_MS / 6);
    sender.input(true);
    expect(sent).toEqual([true, true]);
    vi.useRealTimers();
  });

  it('stops after a pause, on emptying the box, and when told; only once', () => {
    const { sent, sender } = setup();
    sender.input(true);
    vi.advanceTimersByTime(TYPING_IDLE_MS);
    expect(sent).toEqual([true, false]);
    sender.input(true);
    sender.input(false);
    expect(sent).toEqual([true, false, true, false]);
    sender.input(true);
    sender.stop();
    sender.stop();
    expect(sent).toEqual([true, false, true, false, true, false]);
    vi.useRealTimers();
  });

  it('says nothing if it never announced anything', () => {
    const { sent, sender } = setup();
    sender.input(false);
    sender.stop();
    expect(sent).toEqual([]);
    vi.useRealTimers();
  });
});

describe('who to watch', () => {
  it('never exceeds the limit, and the open chat always fits', () => {
    const list = new PresenceWatchList();
    for (let n = 0; n < 150; n++) list.add(`row${n}`, false);
    list.add('open-chat', true);
    const current = list.current();
    expect(current).toHaveLength(100);
    expect(current[0]).toBe('open-chat');
  });

  it('stops watching when the last row showing someone goes away', () => {
    const list = new PresenceWatchList();
    const first = list.add('u', false);
    const second = list.add('u', false);
    first();
    expect(list.current()).toEqual(['u']);
    second();
    expect(list.current()).toEqual([]);
  });
});

describe('live status', () => {
  it('drops "typing…" by itself if the stop never arrives', () => {
    vi.useFakeTimers();
    setTyping('c1', 'u-other', true);
    vi.advanceTimersByTime(TYPING_FALLBACK_MS - 1);
    expect(useLiveStatus.getState().typing.c1).toEqual(['u-other']);
    vi.advanceTimersByTime(1);
    expect(useLiveStatus.getState().typing.c1).toEqual([]);
    vi.useRealTimers();
  });
});

describe('going away', () => {
  it('reports after a minute hidden, not before, and again on returning or reconnecting', () => {
    vi.useFakeTimers();
    const reported: boolean[] = [];
    const tracker = trackAway((active) => reported.push(active));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(AWAY_AFTER_MS - 1);
    expect(reported).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reported).toEqual([false]);
    tracker.reconnected();
    expect(reported).toEqual([false, false]);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reported).toEqual([false, false, true]);
    tracker.reconnected();
    expect(reported).toHaveLength(3);
    tracker.stop();
    visibility.mockRestore();
    vi.useRealTimers();
  });

  it('coming back within the minute says nothing', () => {
    vi.useFakeTimers();
    const reported: boolean[] = [];
    const tracker = trackAway((active) => reported.push(active));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(AWAY_AFTER_MS / 2);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(AWAY_AFTER_MS);
    expect(reported).toEqual([]);
    tracker.stop();
    visibility.mockRestore();
    vi.useRealTimers();
  });
});
