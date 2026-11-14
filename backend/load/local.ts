/**
 * Local load test: N users chatting over Socket.IO while autocannon hits the busiest REST reads.
 * Starts its own API (load/server.ts) against an in-memory MongoDB; no Redis, one instance.
 *   pnpm --filter @zuvo/backend load:local
 *   pnpm --filter @zuvo/backend load:local -- --users 200 --duration 180 --interval 3000
 * See docs/runbooks/load-test.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import type { Socket } from 'socket.io-client';
import { assertPortFree, connect, runApi, sampleServer, startServer, uuidv7 } from './harness.ts';
import type { Seat, ServerStats } from './protocol.ts';
import { type ApiResult, type ChatWindow, renderRun, summarize } from './report.ts';

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    port: { type: 'string', default: '4397' },
    users: { type: 'string', default: '200' },
    'group-size': { type: 'string', default: '25' },
    duration: { type: 'string', default: '180' },
    interval: { type: 'string', default: '3000' },
    'api-seconds': { type: 'string', default: '15' },
    'api-connections': { type: 'string', default: '10' },
    label: { type: 'string', default: 'run' },
  },
});
const PORT = Number(args.port);
const USERS = Number(args.users);
const DURATION_MS = Number(args.duration) * 1000;
const INTERVAL_MS = Number(args.interval);
const API_SECONDS = Number(args['api-seconds']);
const API_CONNECTIONS = Number(args['api-connections']);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line: string) => process.stdout.write(`[load] ${line}\n`);

interface Sent {
  at: number;
  by: number;
  /** How many other members should receive it. */
  fanout: number;
}

async function main() {
  await assertPortFree(PORT);
  log(`starting the API on ${ORIGIN} with ${USERS} users (in-memory MongoDB, no Redis)`);
  const { child, seats, seedMs } = await startServer({
    port: PORT,
    users: USERS,
    groupSize: args['group-size'],
  });
  const serverStats: ServerStats[] = [];
  const stopSampling = sampleServer(child, serverStats);
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  try {
    const t0 = performance.now();
    const clients: Socket[] = [];
    for (let i = 0; i < seats.length; i += 25) {
      clients.push(
        ...(await Promise.all(seats.slice(i, i + 25).map((seat) => connect(ORIGIN, seat)))),
      );
    }
    const connectMs = Math.round(performance.now() - t0);
    log(`seeded in ${seedMs} ms, ${clients.length} sockets connected in ${connectMs} ms`);

    const sent = new Map<string, Sent>();
    const acks: Array<[number, number]> = [];
    const receives: Array<[number, number]> = [];
    const ackErrors: number[] = [];
    const errorCodes: Record<string, number> = {};
    const countError = (code: string) => {
      errorCodes[code] = (errorCodes[code] ?? 0) + 1;
    };
    const cursors = new Map<number, string>();
    clients.forEach((client, n) => {
      const pending = new Map<string, number>();
      client.on('message:new', ({ message, cursor }) => {
        if (!cursors.has(n)) cursors.set(n, cursor);
        const origin = sent.get(message.clientMsgId);
        if (origin && origin.by !== n) receives.push([origin.at, performance.now() - origin.at]);
        // Like the app: tell the server it arrived (coalesced per chat).
        const seq = Math.max(pending.get(message.chatId) ?? 0, message.seq);
        if (!pending.has(message.chatId)) {
          setTimeout(() => {
            const last = pending.get(message.chatId) ?? seq;
            pending.delete(message.chatId);
            client.emit('delivered:update', { chatId: message.chatId, seq: last }, () => {});
          }, 200);
        }
        pending.set(message.chatId, seq);
      });
    });

    const members = new Map<string, number>();
    for (const seat of seats) {
      for (const chat of seat.chats) members.set(chat.id, (members.get(chat.id) ?? 0) + 1);
    }
    const start = performance.now();
    const end = start + DURATION_MS;
    const senders = clients.map(async (client, n) => {
      const seat = seats[n] as Seat;
      await sleep(Math.random() * INTERVAL_MS);
      while (performance.now() < end) {
        const chat = seat.chats[Math.floor(Math.random() * seat.chats.length)];
        if (!chat) return;
        const clientMsgId = uuidv7();
        const at = performance.now();
        sent.set(clientMsgId, { at, by: n, fanout: (members.get(chat.id) ?? 1) - 1 });
        try {
          const ack = await client
            .timeout(30_000)
            .emitWithAck('message:send', { chatId: chat.id, clientMsgId, text: `load ${n} ${at}` });
          if (ack.ok) acks.push([at, performance.now() - at]);
          else {
            ackErrors.push(at);
            countError(ack.error.code);
          }
        } catch {
          ackErrors.push(at);
          countError('ACK_TIMEOUT_30S');
        }
        await sleep(INTERVAL_MS * (0.5 + Math.random()));
      }
    });

    // REST: idle-ish first (chat just starting), then again while everyone is chatting.
    const api: ApiResult[] = [];
    const sample = seats.slice(0, 20);
    const requests = {
      'GET /v1/chats': () =>
        sample.map((s) => ({
          method: 'GET' as const,
          path: '/v1/chats',
          headers: { cookie: s.cookie },
        })),
      'GET /v1/sync': () =>
        sample.map((s, i) => ({
          method: 'GET' as const,
          path: `/v1/sync?since=${cursors.get(i) ?? '0'}`,
          headers: { cookie: s.cookie },
        })),
      'GET /v1/chats/:id/messages': () =>
        sample.map((s) => ({
          method: 'GET' as const,
          path: `/v1/chats/${s.chats[0]?.id}/messages?limit=50`,
          headers: { cookie: s.cookie },
        })),
    };
    const windows: Array<{ label: string; from: number; to: number }> = [];
    const apiPhase = async (phase: ApiResult['phase']) => {
      const from = performance.now();
      for (const [name, build] of Object.entries(requests)) {
        log(`autocannon ${name} (${phase}), ${API_CONNECTIONS} connections, ${API_SECONDS} s`);
        api.push(
          await runApi(
            { origin: ORIGIN, connections: API_CONNECTIONS, seconds: API_SECONDS },
            name,
            phase,
            build(),
          ),
        );
      }
      windows.push({ label: `chat + REST burst (${phase})`, from, to: performance.now() });
    };
    await sleep(Math.min(20_000, DURATION_MS / 4));
    await apiPhase('under chat load');
    await Promise.all(senders);
    await sleep(3000);
    const chatEnd = performance.now();
    windows.unshift({ label: 'whole run', from: start, to: chatEnd });
    const busy = windows.find((w) => w.label.includes('REST'));
    if (busy) {
      windows.push({ label: 'chat only (after the REST burst)', from: busy.to, to: chatEnd });
    }

    const inWindow = (list: Array<[number, number]>, from: number, to: number) =>
      list.filter(([at]) => at >= from && at < to).map(([, ms]) => ms);
    const chat: ChatWindow[] = windows.map(({ label, from, to }) => {
      const sentHere = [...sent.values()].filter((s) => s.at >= from && s.at < to);
      return {
        label,
        seconds: Math.round((to - from) / 1000),
        sent: sentHere.length,
        acked: inWindow(acks, from, to).length,
        ackErrors: ackErrors.filter((at) => at >= from && at < to).length,
        received: inWindow(receives, from, to).length,
        expected: sentHere.reduce((sum, s) => sum + s.fanout, 0),
        ack: summarize(inWindow(acks, from, to)),
        receive: summarize(inWindow(receives, from, to)),
      };
    });

    // Idle REST baseline: nobody chatting, sockets still open.
    await apiPhase('idle');
    windows.pop();
    for (const client of clients) client.disconnect();

    const report = renderRun({
      config: {
        users: USERS,
        groupSize: args['group-size'],
        durationS: DURATION_MS / 1000,
        intervalMs: INTERVAL_MS,
        apiSeconds: API_SECONDS,
        apiConnections: API_CONNECTIONS,
      },
      seedMs,
      connectMs,
      windows: chat,
      api,
      server: serverStats,
      driverLagP99Ms: lag.percentile(99) / 1e6,
      errorCodes,
    });
    const dir = join(import.meta.dirname, 'reports');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${args.label}.md`);
    writeFileSync(file, `${report}\n`);
    process.stdout.write(`\n${report}\n\n[load] report: ${file}\n`);
  } finally {
    lag.disable();
    stopSampling();
    child.removeAllListeners('exit');
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.send({ type: 'stop' });
    await Promise.race([gone, sleep(30_000).then(() => child.kill())]);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `load test failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
