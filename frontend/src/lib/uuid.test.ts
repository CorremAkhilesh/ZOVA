import { clientMsgIdSchema } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('passes the schema the server validates against', () => {
    expect(clientMsgIdSchema.safeParse(uuidv7()).success).toBe(true);
  });

  it('starts with the time, so later ids sort after earlier ones', () => {
    const at = Date.UTC(2026, 10, 4);
    expect(uuidv7(at).replaceAll('-', '').slice(0, 12)).toBe(at.toString(16).padStart(12, '0'));
    expect(uuidv7(at + 1) > uuidv7(at)).toBe(true);
  });

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7(1))).size).toBe(1000);
  });
});
