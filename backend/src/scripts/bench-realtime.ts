/**
 * Local realtime benchmark, report only. Runs the API in a child process against a throwaway
 * in-memory MongoDB: it never touches Atlas, Redis or SMTP.
 *   pnpm --filter @zuvo/backend bench:realtime
 * Options: --sockets 200 --messages 10 --interval 1000 (ms between one socket's sends)
 */
import { fork } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { io, type Socket } from 'socket.io-client';
import { buildApp } from '../app.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { loadEnv } from '../config/env.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { usersModel } from '../users/user-record.ts';

const PORT = Number(process.env.BENCH_PORT ?? 4200);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SECRET = randomBytes(24).toString('hex');
const CHATS_PER_USER = 3;

interface Seat {
  cookie: string;
  chats: string[];
}

/** The child: real API, real transactions, seeded users. Sends the seats to the parent. */
async function serve(sockets: number) {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  const env = loadEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    APP_URL: ORIGIN,
    API_URL: ORIGIN,
    CORS_ORIGINS: ORIGIN,
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: 'zuvo_test_bench',
    REDIS_URL: '',
    SMTP_HOST: 'smtp.invalid',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'nova@corremadvisory.com',
    SMTP_PASS: 'not-used',
    MAIL_FROM: 'nova@corremadvisory.com',
    ALLOWED_EMAIL_DOMAINS: 'corremadvisory.com',
    AUTH_SECRET: process.env.BENCH_SECRET,
    ADMIN_EMAILS: '',
    OTP_IP_LIMIT_PER_HOUR: '10000',
    MEDIA_STORAGE_PATH: './storage/bench',
    LOG_LEVEL: 'error',
  });
  const app = await buildApp(env);
  await app.listen({ host: '127.0.0.1', port: PORT });
  await Promise.all(Object.values(app.mongo.models).map((model) => model.init()));

  const now = new Date();
  const ids = Array.from({ length: sockets }, () => new Types.ObjectId());
  await usersModel(app).collection.insertMany(
    ids.map((_id, n) => ({
      _id,
      email: `bench${n}@corremadvisory.com`,
      emailVerified: true,
      displayName: `Bench ${n}`,
      name: `Bench ${n}`,
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })),
  );
  const sessions = registerAuthModels(app.mongo).AuthSession.collection;
  const seats: Seat[] = [];
  for (const [n, id] of ids.entries()) {
    // Straight into this throwaway database: Better Auth's own helper needs a request context.
    const token = randomBytes(24).toString('hex');
    await sessions.insertOne({
      token,
      userId: id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    const signature = createHmac('sha256', process.env.BENCH_SECRET ?? '')
      .update(token)
      .digest('base64');
    const chats: string[] = [];
    for (let step = 1; step <= CHATS_PER_USER; step++) {
      const other = ids[(n + step) % sockets];
      if (other) chats.push((await getOrCreateDirectChat(app, id.toString(), other.toString())).id);
    }
    seats.push({
      cookie: `zuvo.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
      chats,
    });
  }
  process.send?.({ seats });
  process.on('message', () => {
    void app.close().finally(() => mongo.stop().finally(() => process.exit(0)));
  });
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function summary(label: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return `${label}: n=${sorted.length} p50=${percentile(sorted, 0.5)}ms p95=${percentile(sorted, 0.95)}ms p99=${percentile(sorted, 0.99)}ms max=${sorted.at(-1) ?? 0}ms`;
}

const uuidv7 = () => {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-a${random.slice(3, 6)}-${random.slice(6, 18)}`;
};

/** The parent: the sockets, in their own process so the API has its CPU to itself. */
async function drive(sockets: number, messages: number, interval: number) {
  const child = fork(import.meta.filename, ['--serve', '--sockets', String(sockets)], {
    env: { ...process.env, BENCH_SECRET: SECRET },
    stdio: 'inherit',
  });
  const started = Date.now();
  const seats = await new Promise<Seat[]>((resolve, reject) => {
    child.once('message', (message) => resolve((message as { seats: Seat[] }).seats));
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
  process.stdout.write(`seeded ${seats.length} users in ${Date.now() - started} ms\n`);

  const open = (seat: Seat) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(ORIGIN, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: { cookie: seat.cookie, origin: ORIGIN },
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  const clients: Socket[] = [];
  for (let i = 0; i < seats.length; i += 25) {
    clients.push(...(await Promise.all(seats.slice(i, i + 25).map(open))));
  }
  process.stdout.write(`connected ${clients.length} sockets\n`);

  const delivery: number[] = [];
  const acks: number[] = [];
  let errors = 0;
  let received = 0;
  const sentAt = new Map<string, { at: number; by: Socket }>();
  for (const client of clients) {
    client.on('message:new', ({ message }: { message: { clientMsgId: string } }) => {
      const sent = sentAt.get(message.clientMsgId);
      // The other person's device only: the sender's own copy arrives with the ack.
      if (!sent || sent.by === client) return;
      const { at } = sent;
      received += 1;
      delivery.push(Date.now() - at);
    });
  }

  const runStart = Date.now();
  await Promise.all(
    clients.map(async (client, n) => {
      const chats = seats[n]?.chats ?? [];
      await new Promise((resolve) => setTimeout(resolve, Math.random() * interval));
      for (let m = 0; m < messages; m++) {
        const clientMsgId = uuidv7();
        const chatId = chats[Math.floor(Math.random() * chats.length)];
        const at = Date.now();
        sentAt.set(clientMsgId, { at, by: client });
        try {
          const ack = await client
            .timeout(60_000)
            .emitWithAck('message:send', { chatId, clientMsgId, text: `bench ${n}.${m}` });
          acks.push(Date.now() - at);
          if (!ack.ok) errors += 1;
        } catch {
          errors += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const seconds = (Date.now() - runStart) / 1000;

  process.stdout.write(
    `${[
      `sockets=${clients.length} messages each=${messages} interval=${interval}ms`,
      `sent=${acks.length} errors=${errors} delivered to the other person=${received} in ${seconds.toFixed(1)} s`,
      summary('send → ack', acks),
      summary('send → receive', delivery),
    ].join('\n')}\n`,
  );
  for (const client of clients) client.disconnect();
  child.removeAllListeners('exit');
  const gone = new Promise((resolve) => child.once('exit', resolve));
  child.send('stop');
  await gone;
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    serve: { type: 'boolean', default: false },
    sockets: { type: 'string', default: '200' },
    messages: { type: 'string', default: '10' },
    interval: { type: 'string', default: '1000' },
  },
});
const run = values.serve
  ? serve(Number(values.sockets))
  : drive(Number(values.sockets), Number(values.messages), Number(values.interval));
run.catch((error: unknown) => {
  process.stderr.write(`bench failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
