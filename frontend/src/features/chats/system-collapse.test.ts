import type { SystemEvent } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { repeatsSystem } from './system-collapse';

const asha = { id: 'u-asha', name: 'Asha' };
const ravi = { id: 'u-ravi', name: 'Ravi' };
const event = (overrides: Partial<SystemEvent>): SystemEvent => ({
  kind: 'photo_changed',
  actor: asha,
  targets: [],
  value: null,
  ...overrides,
});

describe('a run of the same system line', () => {
  it('joins photo and description changes by the same person, whatever the new value', () => {
    expect(repeatsSystem(event({}), event({ value: 'v2' }))).toBe(true);
    expect(
      repeatsSystem(event({ kind: 'description_changed' }), event({ kind: 'description_changed' })),
    ).toBe(true);
  });

  it('keeps lines apart when someone else did it, or they say something different', () => {
    expect(repeatsSystem(event({}), event({ actor: ravi }))).toBe(false);
    expect(
      repeatsSystem(event({ kind: 'renamed', value: 'A' }), event({ kind: 'renamed', value: 'B' })),
    ).toBe(false);
    expect(
      repeatsSystem(
        event({ kind: 'added', targets: [ravi] }),
        event({ kind: 'added', targets: [asha] }),
      ),
    ).toBe(false);
    expect(repeatsSystem(undefined, event({}))).toBe(false);
  });
});
