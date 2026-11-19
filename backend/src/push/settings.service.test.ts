import { DEFAULT_PUSH_SETTINGS } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { toPushSettings } from './settings.service.ts';

// "Default on" for everyone: an account that never changed anything has nothing stored, and every
// field that was never set reads its default (on). No migration has to rewrite old accounts.
describe('notification settings over the defaults', () => {
  it('a new account, or one that never changed anything: everything on', () => {
    expect(toPushSettings(undefined)).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(toPushSettings(null)).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(toPushSettings({})).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(Object.values(toPushSettings({})).filter((value) => value === false)).toEqual([]);
  });

  it('an older account (preview and sound only): its choices kept, the new kinds on', () => {
    expect(toPushSettings({ showPreview: false, sound: true })).toEqual({
      ...DEFAULT_PUSH_SETTINGS,
      showPreview: false,
    });
  });

  it('one unreadable field falls back alone, never the whole set', () => {
    const stored = {
      tone: 'horn',
      soundVolume: 30,
      tickTone: 'tick-soft',
    } as unknown as Parameters<typeof toPushSettings>[0];
    expect(toPushSettings(stored)).toEqual({
      ...DEFAULT_PUSH_SETTINGS,
      soundVolume: 30,
      tickTone: 'tick-soft',
    });
  });

  it('the send sound: Droplet C for everyone on the default; an older "off" stays off', () => {
    expect(toPushSettings({}).sentTone).toBe('droplet-c');
    expect(toPushSettings({ soundSent: true }).sentTone).toBe('droplet-c');
    expect(toPushSettings({ soundSent: false }).sentTone).toBe('off');
    // A choice made since wins over the older switch.
    expect(toPushSettings({ soundSent: false, sentTone: 'droplet-a' }).sentTone).toBe('droplet-a');
  });

  it('choices already made are kept: tone, mention and tick sounds', () => {
    const kept = toPushSettings({
      tone: 'marimba',
      mentionTone: 'mention-soft',
      soundMentions: false,
    });
    expect(kept).toMatchObject({
      tone: 'marimba',
      mentionTone: 'mention-soft',
      soundMentions: false,
    });
    expect(kept.tickTone).toBe('tick');
  });
});
