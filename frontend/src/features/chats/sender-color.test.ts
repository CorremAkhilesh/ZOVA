import { describe, expect, it } from 'vitest';
import { SENDER_COLOR_CLASSES, senderColorClass } from './sender-color';

describe('senderColorClass', () => {
  it('is stable for the same user id', () => {
    expect(senderColorClass('u-riya')).toBe(senderColorClass('u-riya'));
  });

  it('always returns one of the 8 token classes', () => {
    for (let i = 0; i < 200; i++) {
      expect(SENDER_COLOR_CLASSES).toContain(senderColorClass(`user-${i}`));
    }
  });

  it('spreads users across the palette', () => {
    const used = new Set(Array.from({ length: 100 }, (_, i) => senderColorClass(`member-${i}`)));
    expect(used.size).toBe(SENDER_COLOR_CLASSES.length);
  });
});
