import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../../test/helpers.ts';
import { closeAllSockets, connect, listen, send, signedIn } from '../../test/realtime-helpers.ts';
import { AppError } from '../lib/errors.ts';
import { safeReason } from './handlers.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => ctx.app;

beforeAll(async () => {
  ctx = await buildTestApp();
  url = await listen(app());
});
afterEach(() => {
  closeAllSockets();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('failed socket events are logged', () => {
  it('logs a refused message:send with its code and reason, never its text', async () => {
    const alice = await signedIn(app(), 'alice@corremadvisory.com');
    const socket = await connect(url, alice.cookie);
    const warn = vi.spyOn(app().log, 'warn');
    const ack = await send(socket, '0'.repeat(24), 'a secret message');
    expect(ack.ok).toBe(false);
    const [fields, message] = warn.mock.calls.at(-1) ?? [];
    expect(message).toBe('socket event refused');
    expect(fields).toMatchObject({
      event: 'message:send',
      code: 'NOT_FOUND',
      reason: 'Chat not found.',
      userId: alice.id,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('a secret message');
  });
});

describe('safeReason', () => {
  it('keeps our own messages', () => {
    expect(safeReason(new AppError('FORBIDDEN', 'Not allowed.'))).toBe('Not allowed.');
  });

  it('keeps only the name and code of anything else, which may quote the message', () => {
    const error = Object.assign(new TypeError('value "a secret" is too long'), { code: 11000 });
    expect(safeReason(error)).toBe('TypeError 11000');
    expect(safeReason(new RangeError('a secret'))).toBe('RangeError');
    expect(safeReason('a secret')).toBe('unknown');
  });
});
