import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserTimeZone,
  checkSendAt,
  DEFAULT_ZONE,
  fromInputs,
  nextMondayAt,
  toInputs,
  tomorrowAt,
  zoneOffsetName,
} from './time';

// Thursday 12 November 2026, 10:00 in India.
const NOW = new Date('2026-11-12T04:30:00.000Z');

afterEach(() => vi.restoreAllMocks());

describe('quick choices', () => {
  it('"Tomorrow 9 AM" is 9:00 tomorrow in my time zone', () => {
    expect(tomorrowAt(NOW, 'Asia/Kolkata').toISOString()).toBe('2026-11-13T03:30:00.000Z');
    // Still Wednesday evening in New York.
    expect(tomorrowAt(NOW, 'America/New_York').toISOString()).toBe('2026-11-12T14:00:00.000Z');
  });

  it('uses the date where I am, not in UTC', () => {
    // 23:30 on Thursday in UTC is already Friday 05:00 in India.
    const late = new Date('2026-11-12T23:30:00.000Z');
    expect(tomorrowAt(late, 'Asia/Kolkata').toISOString()).toBe('2026-11-14T03:30:00.000Z');
  });

  it('"Monday 9 AM" is the coming Monday, or next week’s on a Monday', () => {
    expect(nextMondayAt(NOW, 'Asia/Kolkata').toISOString()).toBe('2026-11-16T03:30:00.000Z');
    const monday = new Date('2026-11-16T04:30:00.000Z');
    expect(nextMondayAt(monday, 'Asia/Kolkata').toISOString()).toBe('2026-11-23T03:30:00.000Z');
    const sunday = new Date('2026-11-15T04:30:00.000Z');
    expect(nextMondayAt(sunday, 'Asia/Kolkata').toISOString()).toBe('2026-11-16T03:30:00.000Z');
  });

  it('keeps 9:00 on the wall clock across a daylight-saving change', () => {
    // US clocks go forward on Sunday 14 March 2027.
    const saturday = new Date('2027-03-13T15:00:00.000Z');
    expect(tomorrowAt(saturday, 'America/New_York').toISOString()).toBe('2027-03-14T13:00:00.000Z');
    expect(nextMondayAt(saturday, 'America/New_York').toISOString()).toBe(
      '2027-03-15T13:00:00.000Z',
    );
  });
});

describe('the date and time pickers', () => {
  it('reads and writes the picker values in my time zone', () => {
    expect(toInputs(NOW, 'Asia/Kolkata')).toEqual({ date: '2026-11-12', time: '10:00' });
    expect(fromInputs('2026-11-20', '18:45', 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-11-20T13:15:00.000Z',
    );
  });

  it('refuses missing or malformed values', () => {
    expect(fromInputs('', '10:00', 'Asia/Kolkata')).toBeNull();
    expect(fromInputs('2026-11-20', '', 'Asia/Kolkata')).toBeNull();
    expect(fromInputs('2026-13-01', '10:00', 'Asia/Kolkata')).toBeNull();
    expect(fromInputs('2026-11-20', '25:00', 'Asia/Kolkata')).toBeNull();
  });

  it('names the zone with its offset', () => {
    expect(zoneOffsetName('Asia/Kolkata', NOW)).toBe('GMT+5:30');
  });
});

describe('limits', () => {
  it('past, too soon, more than a year ahead, or fine', () => {
    expect(checkSendAt(null, NOW)).toBe('invalid');
    expect(checkSendAt(new Date(NOW.getTime() - 1000), NOW)).toBe('past');
    expect(checkSendAt(NOW, NOW)).toBe('past');
    expect(checkSendAt(new Date(NOW.getTime() + 30_000), NOW)).toBe('tooSoon');
    expect(checkSendAt(new Date(NOW.getTime() + 366 * 86_400_000), NOW)).toBe('tooFar');
    expect(checkSendAt(new Date(NOW.getTime() + 365 * 86_400_000), NOW)).toBeNull();
    expect(checkSendAt(new Date(NOW.getTime() + 60_000), NOW)).toBeNull();
  });
});

describe('my time zone', () => {
  it('is the browser’s, or India’s when the browser can’t say', () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    spy.mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: 'Europe/London' };
    });
    expect(browserTimeZone()).toBe('Europe/London');
    spy.mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: '' };
    });
    expect(browserTimeZone()).toBe(DEFAULT_ZONE);
    spy.mockImplementation(() => {
      throw new RangeError('no zone');
    });
    expect(browserTimeZone()).toBe('Asia/Kolkata');
  });
});
