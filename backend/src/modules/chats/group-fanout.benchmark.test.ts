import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  signedIn,
  type TestSocket,
  uuidv7,
} from '../../../test/realtime-helpers.ts';
import { insertUser } from '../../../test/user-helpers.ts';
import { createGroup } from '../../chats/groups.service.ts';

const MEMBERS = 256;
const LISTENING = 40;
const MESSAGES = 60;
/** Under the limit of 20 messages per 5 seconds. */
const PACE_MS = 300;

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};
const summary = (values: number[]) =>
  `p50 ${percentile(values, 0.5).toFixed(0)} ms, p95 ${percentile(values, 0.95).toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`;

// Slow, and its numbers only mean something on a quiet machine: run it on purpose with
// RUN_BENCHMARK=1 pnpm --filter @zuvo/backend exec vitest run group-fanout
describe.skipIf(!process.env.RUN_BENCHMARK)('send to receive in a 256-member group', () => {
  let built: Awaited<ReturnType<typeof buildTestApp>>;
  beforeAll(async () => {
    built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000', LOG_LEVEL: 'silent' });
  }, 120_000);
  afterAll(async () => {
    closeAllSockets();
    await built.cleanup();
  });

  it('stays fast', async () => {
    const { app } = built;
    const url = await listen(app);
    const people = await Promise.all(
      Array.from({ length: LISTENING }, (_unused, n) =>
        signedIn(app, `bench${n}@corremadvisory.com`),
      ),
    );
    const silent = await Promise.all(
      Array.from({ length: MEMBERS - LISTENING }, (_unused, n) =>
        insertUser(app, { email: `quiet${n}@corremadvisory.com` }),
      ),
    );
    const [sender, ...others] = people;
    if (!sender) throw new Error('No sender');
    const chat = await createGroup(app, sender.id, {
      name: 'Benchmark',
      description: '',
      memberIds: [...others.map((other) => other.id), ...silent],
    });
    expect(chat.group?.memberCount).toBe(MEMBERS);

    const senderSocket = await connect(url, sender.cookie);
    const sockets: TestSocket[] = await Promise.all(
      others.map((other) => connect(url, other.cookie)),
    );
    const sentAt = new Map<string, number>();
    const deliveries: number[] = [];
    for (const socket of sockets) {
      socket.on('message:new', ({ message }) => {
        const started = message.clientMsgId && sentAt.get(message.clientMsgId);
        if (started) deliveries.push(performance.now() - started);
      });
    }

    const acks: number[] = [];
    for (let n = 0; n < MESSAGES; n += 1) {
      const clientMsgId = uuidv7();
      const started = performance.now();
      sentAt.set(clientMsgId, started);
      const ack = await senderSocket.emitWithAck('message:send', {
        chatId: chat.id,
        clientMsgId,
        text: `message ${n}`,
      });
      expect(ack.ok).toBe(true);
      acks.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(deliveries).toHaveLength(MESSAGES * (LISTENING - 1));
    process.stdout.write(
      `\nBENCH ${MEMBERS} members, ${MESSAGES} messages, ${LISTENING - 1} listening sockets\n` +
        `BENCH sender's answer: ${summary(acks)}\nBENCH send to receive: ${summary(deliveries)}\n`,
    );
  }, 300_000);
});
