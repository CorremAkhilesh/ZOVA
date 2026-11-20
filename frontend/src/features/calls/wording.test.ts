import type { SystemEvent } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { systemText } from '@/features/groups/wording';
import { i18n, initI18n } from '@/lib/i18n';
import { judgeQuality } from './rtc';

initI18n({ language: 'en' });
const t = i18n.getFixedT('en');
const hi = i18n.getFixedT('hi');

const event = (value: string): SystemEvent => ({
  kind: 'call',
  actor: { id: 'asha', name: 'Asha' },
  targets: [{ id: 'bharat', name: 'Bharat' }],
  value,
});

describe('a call’s line in the chat', () => {
  it('answered: "Voice call · 2:31" for both', () => {
    expect(systemText(event('voice:answered:151'), 'asha', t)).toBe('Voice call · 2:31');
    expect(systemText(event('voice:answered:151'), 'bharat', t)).toBe('Voice call · 2:31');
    expect(systemText(event('voice:answered:3725'), 'bharat', t)).toBe('Voice call · 1:02:05');
  });

  it('not answered: missed for the person called, "no answer" for the caller', () => {
    for (const outcome of ['missed', 'cancelled', 'busy']) {
      expect(systemText(event(`voice:${outcome}`), 'bharat', t)).toBe('Missed voice call');
    }
    expect(systemText(event('voice:missed'), 'asha', t)).toBe('Voice call · No answer');
    expect(systemText(event('voice:busy'), 'asha', t)).toBe('Voice call · Busy');
    expect(systemText(event('voice:declined'), 'bharat', t)).toBe('Declined voice call');
  });

  it('in Hindi, and something unknown still reads as a call', () => {
    expect(systemText(event('voice:missed'), 'bharat', hi)).toBe('छूटी हुई वॉइस कॉल');
    expect(systemText(event('video:whatever'), 'bharat', t)).toBe('Voice call');
  });
});

describe('the quality indicator', () => {
  it('good, fair, poor from round-trip time and loss', () => {
    expect(judgeQuality(0.05, 0)).toBe('good');
    expect(judgeQuality(0.4, 0)).toBe('fair');
    expect(judgeQuality(0.1, 0.05)).toBe('fair');
    expect(judgeQuality(0.1, 0.2)).toBe('poor');
    expect(judgeQuality(null, null)).toBeNull();
  });
});
