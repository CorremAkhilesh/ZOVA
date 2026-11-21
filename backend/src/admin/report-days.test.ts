import { describe, expect, it } from 'vitest';
import { dayKey, dayStart, idFrom, lastDays } from './report-days.ts';

describe('report days (India time)', () => {
  it('a day starts at midnight in India, not in UTC', () => {
    expect(dayKey(new Date('2026-11-20T18:29:59Z'))).toBe('2026-11-20');
    expect(dayKey(new Date('2026-11-20T18:30:00Z'))).toBe('2026-11-21');
    expect(dayStart('2026-11-21').toISOString()).toBe('2026-11-20T18:30:00.000Z');
  });

  it('lists the last days oldest first, ending today, across a month end', () => {
    expect(lastDays(new Date('2026-12-02T10:00:00Z'), 4)).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
    expect(lastDays(new Date(), 30)).toHaveLength(30);
  });

  it('turns a moment into the first id made then', () => {
    const at = new Date('2026-11-21T00:00:00Z');
    expect(idFrom(at).getTimestamp().toISOString()).toBe(at.toISOString());
  });
});
