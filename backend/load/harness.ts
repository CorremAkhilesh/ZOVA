/** Pieces of the load test: the API child process, socket clients, autocannon. */
import { type ChildProcess, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import autocannon from 'autocannon';
import { io, type Socket } from 'socket.io-client';
import type { Seat, ServerMessage, ServerStats } from './protocol.ts';
import type { ApiResult } from './report.ts';

export function assertPortFree(port: number) {
  return new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`port ${port} is taken: refusing to run`)));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

export function startServer(options: {
  port: number;
  users: number;
  groupSize: string;
}): Promise<{ child: ChildProcess; seats: Seat[]; seedMs: number }> {
  const child = fork(join(import.meta.dirname, 'server.ts'), [], {
    env: {
      ...process.env,
      LOAD_PORT: String(options.port),
      LOAD_USERS: String(options.users),
      LOAD_GROUP_SIZE: options.groupSize,
      LOAD_SECRET: randomBytes(24).toString('hex'),
    },
    stdio: 'inherit',
    // LOAD_CPU_PROF=<dir>: a V8 CPU profile of the API (open it in Chrome DevTools).
    execArgv: process.env.LOAD_CPU_PROF
      ? [...process.execArgv, '--cpu-prof', `--cpu-prof-dir=${process.env.LOAD_CPU_PROF}`]
      : process.execArgv,
  });
  return new Promise((resolve, reject) => {
    child.on('message', (message: ServerMessage) => {
      if (message.type === 'ready')
        resolve({ child, seats: message.seats, seedMs: message.seedMs });
    });
    child.once('exit', (code) => reject(new Error(`API exited early (code ${code})`)));
  });
}

export function sampleServer(child: ChildProcess, into: ServerStats[]) {
  child.on('message', (message: ServerMessage) => {
    if (message.type === 'stats') into.push(message.stats);
  });
  const timer = setInterval(() => child.send({ type: 'stats' }), 1000);
  return () => clearInterval(timer);
}

export function connect(origin: string, seat: Seat) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = io(origin, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { cookie: seat.cookie, origin },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export const uuidv7 = () => {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-a${random.slice(3, 6)}-${random.slice(6, 18)}`;
};

export async function runApi(
  target: { origin: string; connections: number; seconds: number },
  name: string,
  phase: ApiResult['phase'],
  requests: autocannon.Request[],
) {
  const result = await autocannon({
    url: target.origin,
    connections: target.connections,
    duration: target.seconds,
    // Seconds; autocannon counts a request with no answer by then as a timeout.
    timeout: 30,
    requests,
  });
  const p = result.latency;
  return {
    name,
    phase,
    requests: result.requests.total,
    rps: result.requests.average,
    p50: p.p50,
    // autocannon reports p90, p97.5 and p99 (no p95).
    p95: p.p97_5,
    p99: p.p99,
    max: p.max,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    avgBytes: result.throughput.total / Math.max(1, result.requests.total),
  } satisfies ApiResult;
}
