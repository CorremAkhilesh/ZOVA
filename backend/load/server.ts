/**
 * The API under test, in its own process (so its CPU and memory are its own): the real `buildApp`
 * against a throwaway in-memory MongoDB replica set, NODE_ENV=test, no Redis, one instance.
 * Never touches Atlas, Redis or SMTP. Started by `load/local.ts`, not meant to be run by hand.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { buildApp } from '../src/app.ts';
import { getOrCreateDirectChat } from '../src/chats/chats.service.ts';
import { createGroup } from '../src/chats/groups.service.ts';
import { loadEnv } from '../src/config/env.ts';
import { registerAuthModels } from '../src/db/auth-models.ts';
import { registerModels } from '../src/db/models.ts';
import { usersModel } from '../src/users/user-record.ts';
import type { Seat, ServerMessage, ServerStats } from './protocol.ts';

const PORT = Number(process.env.LOAD_PORT);
const USERS = Number(process.env.LOAD_USERS);
const GROUP_SIZE = Number(process.env.LOAD_GROUP_SIZE);
const SECRET = process.env.LOAD_SECRET ?? '';
const ORIGIN = `http://127.0.0.1:${PORT}`;

const send = (message: ServerMessage) => process.send?.(message);

/**
 * A one-member replica set (transactions need one), started by hand: `MongoMemoryReplSet` gives up
 * after 30 s waiting for a primary, which the shared dev server can exceed when it is busy.
 */
async function startMongo() {
  const server = await MongoMemoryServer.create({
    instance: { replSet: 'rs0', storageEngine: 'wiredTiger', launchTimeout: 300_000 },
  });
  const host = `127.0.0.1:${server.instanceInfo?.port}`;
  const admin = await MongoClient.connect(`mongodb://${host}/`, {
    directConnection: true,
    serverSelectionTimeoutMS: 300_000,
  });
  try {
    await admin.db('admin').command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host }],
        // Majority writes do not wait for the journal's fsync: on the shared dev server's disk one
        // fsync took seconds and buried every other number. Atlas journals on fast SSDs.
        writeConcernMajorityJournalDefault: false,
      },
    });
    const deadline = Date.now() + 300_000;
    while (!(await admin.db('admin').command({ hello: 1 })).isWritablePrimary) {
      if (Date.now() > deadline) throw new Error('mongod never became primary');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    await admin.close();
  }
  return { uri: `mongodb://${host}/?replicaSet=rs0`, stop: () => server.stop() };
}
const mongo = await startMongo();
// A failed start must not leave mongod running.
const fail = (error: unknown) => {
  process.stderr.write(
    `load API failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  void mongo.stop().finally(() => process.exit(1));
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const env = loadEnv({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  APP_URL: ORIGIN,
  API_URL: ORIGIN,
  CORS_ORIGINS: ORIGIN,
  MONGODB_URI: mongo.uri,
  MONGODB_DB: 'zuvo_test_load',
  REDIS_URL: '',
  SMTP_HOST: 'smtp.invalid',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'nova@corremadvisory.com',
  SMTP_PASS: 'not-used',
  MAIL_FROM: 'nova@corremadvisory.com',
  ALLOWED_EMAIL_DOMAINS: 'corremadvisory.com',
  AUTH_SECRET: SECRET,
  ADMIN_EMAILS: '',
  OTP_IP_LIMIT_PER_HOUR: '10000',
  MEDIA_STORAGE_PATH: './storage/load',
  LOG_LEVEL: process.env.LOAD_LOG_LEVEL ?? 'error',
});
const booted = Date.now();
const step = (what: string) =>
  process.stdout.write(`[api] ${what} after ${Date.now() - booted} ms\n`);
step('mongod started');

/**
 * Collections and indexes first, one at a time and with no socket timeout. On the shared Windows
 * dev server each new collection or index file can take seconds; `buildApp` building all of them at
 * once then exceeds the API's 45 s socket timeout. With them in place, its own index pass is a no-op.
 */
async function prepareCollections() {
  const setup = await mongoose
    .createConnection(env.MONGODB_URI, { dbName: env.MONGODB_DB, autoIndex: false })
    .asPromise();
  registerModels(setup);
  for (const model of Object.values(setup.models)) {
    await model.createCollection();
    await model.createIndexes();
  }
  await setup.close();
}
await prepareCollections();
step('collections and indexes ready');
const app = await buildApp(env);
await Promise.all(Object.values(app.mongo.models).map((model) => model.init()));
await app.listen({ host: '127.0.0.1', port: PORT });
step('API listening');

/** Users and sessions go straight into this throwaway database: Better Auth needs a request. */
async function seedUsers(count: number) {
  const now = new Date();
  const ids = Array.from({ length: count }, () => new Types.ObjectId());
  await usersModel(app).collection.insertMany(
    ids.map((_id, n) => ({
      _id,
      email: `load${n}@corremadvisory.com`,
      emailVerified: true,
      displayName: `Load ${n}`,
      name: `Load ${n}`,
      username: `load${n}`,
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    })),
  );
  const tokens = ids.map(() => randomBytes(24).toString('hex'));
  await registerAuthModels(app.mongo).AuthSession.collection.insertMany(
    ids.map((userId, n) => ({
      token: tokens[n],
      userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    })),
  );
  return ids.map((id, n) => {
    const token = tokens[n] ?? '';
    const signature = createHmac('sha256', SECRET).update(token).digest('base64');
    return {
      userId: id.toString(),
      cookie: `zuvo.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
    };
  });
}

/**
 * Each user: a partner (0↔1, 2↔3, …), a second 1:1 a few seats away, and one group of
 * `GROUP_SIZE` (the first member creates it).
 */
async function seed(): Promise<Seat[]> {
  const people = await seedUsers(USERS);
  const seats: Seat[] = people.map((person) => ({ ...person, chats: [] }));
  const add = (n: number, chatId: string, kind: 'direct' | 'group') =>
    seats[n]?.chats.push({ id: chatId, kind });
  for (let n = 0; n < USERS; n++) {
    const pairs = [n ^ 1, (n + 7) % USERS].filter((other) => other > n && other < USERS);
    for (const other of pairs) {
      const chat = await getOrCreateDirectChat(
        app,
        people[n]?.userId ?? '',
        people[other]?.userId ?? '',
      );
      add(n, chat.id, 'direct');
      add(other, chat.id, 'direct');
    }
  }
  for (let start = 0; start + 1 < USERS; start += GROUP_SIZE) {
    const members = people.slice(start, start + GROUP_SIZE);
    const [owner, ...rest] = members;
    if (!owner || rest.length === 0) continue;
    const group = await createGroup(app, owner.userId, {
      name: `Load group ${start / GROUP_SIZE + 1}`,
      description: '',
      memberIds: rest.map((member) => member.userId),
    });
    for (let n = start; n < start + members.length; n++) add(n, group.id, 'group');
  }
  return seats;
}

const failedCommands: Record<string, number> = {};
app.mongo.getClient().on('commandFailed', (event) => {
  const name = (event.failure as { codeName?: string }).codeName ?? event.failure.name;
  failedCommands[name] = (failedCommands[name] ?? 0) + 1;
});

function stats(): ServerStats {
  const cpu = process.cpuUsage();
  const memory = process.memoryUsage();
  return {
    at: Date.now(),
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    rssMb: memory.rss / 1_048_576,
    heapUsedMb: memory.heapUsed / 1_048_576,
    sockets: app.realtime.io.engine.clientsCount,
    failedCommands: { ...failedCommands },
  };
}

process.on('message', (message: { type: string }) => {
  if (message.type === 'stats') send({ type: 'stats', stats: stats() });
  if (message.type === 'stop') {
    void app
      .close()
      .finally(() => mongo.stop())
      .finally(() => process.exit(0));
  }
});

const started = Date.now();
const seats = await seed();
send({ type: 'ready', seats, seedMs: Date.now() - started });
