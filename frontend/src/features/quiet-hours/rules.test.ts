import { DEFAULT_QUIET_HOURS, DEFAULT_TIMEZONE } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQuietNow, shouldAlert, useQuietStore } from './quiet';
import {
  browserTimezone,
  initialForm,
  isValidTimezone,
  quietProblem,
  sameDays,
  timezoneOptions,
} from './rules';

afterEach(() => {
  vi.restoreAllMocks();
  useQuietStore.setState({ settings: DEFAULT_QUIET_HOURS });
});

describe('quietProblem', () => {
  const scheduled = { ...DEFAULT_QUIET_HOURS, mode: 'scheduled' as const };
  it('accepts off, on and a proper schedule', () => {
    expect(quietProblem(DEFAULT_QUIET_HOURS)).toBeNull();
    expect(
      quietProblem({ ...DEFAULT_QUIET_HOURS, mode: 'on', start: '08:00', end: '08:00' }),
    ).toBeNull();
    expect(quietProblem(scheduled)).toBeNull();
  });
  it('refuses equal times, no days and an unknown zone', () => {
    expect(quietProblem({ ...scheduled, start: '08:00', end: '08:00' })).toBe('sameTimes');
    expect(quietProblem({ ...scheduled, days: [] })).toBe('noDays');
    expect(quietProblem({ ...scheduled, timezone: 'Mars/Olympus' })).toBe('badTimezone');
  });
});

describe('time zones', () => {
  it('knows real zones', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Nowhere/Land')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it("uses the browser's zone, or India's when it has none", () => {
    expect(isValidTimezone(browserTimezone())).toBe(true);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: '',
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(browserTimezone()).toBe(DEFAULT_TIMEZONE);
  });

  it('lists extra zones first, once, and drops invalid ones', () => {
    const options = timezoneOptions('Pacific/Auckland', 'Asia/Kolkata', 'Bad/Zone');
    expect(options[0]).toBe('Pacific/Auckland');
    expect(options.filter((zone) => zone === 'Asia/Kolkata')).toHaveLength(1);
    expect(options).not.toContain('Bad/Zone');
  });

  it('starts an untouched setup from this device’s zone, but keeps a chosen one', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Paris',
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(initialForm(DEFAULT_QUIET_HOURS).timezone).toBe('Europe/Paris');
    const chosen = { ...DEFAULT_QUIET_HOURS, mode: 'on' as const };
    expect(initialForm(chosen)).toBe(chosen);
  });
});

describe('sameDays', () => {
  it('ignores order', () => {
    expect(sameDays([0, 6], [6, 0])).toBe(true);
    expect(sameDays([0], [0, 6])).toBe(false);
  });
});

describe('isQuietNow / shouldAlert', () => {
  it('are quiet only while on, and let exceptions through', () => {
    expect(isQuietNow()).toBe(false);
    expect(shouldAlert({ chatId: 'c1', mentionsMe: false })).toBe(true);
    useQuietStore.getState().setSettings({
      ...DEFAULT_QUIET_HOURS,
      mode: 'on',
      allowMentions: false,
      allowChatIds: ['c2'],
    });
    expect(isQuietNow()).toBe(true);
    expect(shouldAlert({ chatId: 'c1', mentionsMe: true })).toBe(false);
    expect(shouldAlert({ chatId: 'c2', mentionsMe: false })).toBe(true);
  });
});
