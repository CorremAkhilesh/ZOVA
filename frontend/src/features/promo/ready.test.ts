import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMO_DELAY_MS, usePromoReady } from './ready';

describe('usePromoReady', () => {
  let idle: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    idle = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: () => void) => idle.push(callback)),
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for the rows, then the delay, then an idle moment', () => {
    const { result, rerender } = renderHook(({ rows }) => usePromoReady(rows), {
      initialProps: { rows: false },
    });
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS * 3));
    expect(result.current).toBe(false);
    expect(idle).toHaveLength(0);

    rerender({ rows: true });
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS - 1));
    expect(idle).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(idle).toHaveLength(1);
    expect(result.current).toBe(false);

    act(() => idle[0]?.());
    expect(result.current).toBe(true);
    // Stays ready when the rows go (another folder, a search).
    rerender({ rows: false });
    expect(result.current).toBe(true);
  });

  it('cancels the wait when the rows go away first', () => {
    const { result, rerender, unmount } = renderHook(({ rows }) => usePromoReady(rows), {
      initialProps: { rows: true },
    });
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS));
    rerender({ rows: false });
    expect(cancelIdleCallback).toHaveBeenCalled();
    expect(result.current).toBe(false);
    unmount();
  });

  it('without requestIdleCallback, is ready right after the delay', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const { result } = renderHook(() => usePromoReady(true));
    act(() => vi.advanceTimersByTime(PROMO_DELAY_MS));
    expect(result.current).toBe(true);
  });
});
