/** Percentiles and the Markdown report of a load-test run. */
import { cpus, totalmem } from 'node:os';
import type { ServerStats } from './protocol.ts';

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarize(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const round = (value: number | undefined) => Math.round((value ?? 0) * 10) / 10;
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted.at(-1)),
  };
}

export interface ApiResult {
  name: string;
  phase: 'idle' | 'under chat load';
  requests: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
  timeouts: number;
  non2xx: number;
  avgBytes: number;
}

export interface ChatWindow {
  label: string;
  seconds: number;
  sent: number;
  acked: number;
  ackErrors: number;
  received: number;
  expected: number;
  ack: Summary;
  receive: Summary;
}

export interface RunReport {
  config: Record<string, number | string>;
  seedMs: number;
  connectMs: number;
  windows: ChatWindow[];
  api: ApiResult[];
  server: ServerStats[];
  driverLagP99Ms: number;
  /** Failed sends by error code (`ACK_TIMEOUT_30S` = no ack within 30 s). */
  errorCodes: Record<string, number>;
}

/** CPU % of one core, averaged over each sampling interval. */
export function cpuPercents(samples: ServerStats[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]];
    if (!a || !b || b.at === a.at) continue;
    const used = b.cpuUserMs + b.cpuSystemMs - a.cpuUserMs - a.cpuSystemMs;
    out.push((used / (b.at - a.at)) * 100);
  }
  return out;
}

const row = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;

export function renderRun(report: RunReport): string {
  const cpu = cpuPercents(report.server);
  const avg = cpu.reduce((sum, value) => sum + value, 0) / Math.max(1, cpu.length);
  const rss = Math.max(...report.server.map((s) => s.rssMb));
  const heap = Math.max(...report.server.map((s) => s.heapUsedMb));
  const config = Object.entries(report.config)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const lines = [
    `Machine: ${cpus().length} logical CPUs, ${Math.round(totalmem() / 1_073_741_824)} GB RAM, shared with other users.`,
    `Config: ${config}`,
    `Seeding: ${report.seedMs} ms; ${report.config.users} sockets connected in ${report.connectMs} ms.`,
    '',
    '#### Chat (socket.io): send → ack, send → receive at each other member',
    '',
    row([
      'Window',
      's',
      'sent',
      'msg/s',
      'ack errors',
      'received/expected',
      'ack p50/p95/p99/max ms',
      'receive p50/p95/p99/max ms',
    ]),
    row(['---', '---', '---', '---', '---', '---', '---', '---']),
    ...report.windows.map((w) =>
      row([
        w.label,
        w.seconds,
        w.sent,
        (w.sent / Math.max(1, w.seconds)).toFixed(1),
        w.ackErrors,
        `${w.received}/${w.expected}`,
        `${w.ack.p50} / ${w.ack.p95} / ${w.ack.p99} / ${w.ack.max}`,
        `${w.receive.p50} / ${w.receive.p95} / ${w.receive.p99} / ${w.receive.max}`,
      ]),
    ),
    '',
    '#### REST (autocannon)',
    '',
    row([
      'Endpoint',
      'Phase',
      'req',
      'req/s',
      'p50 ms',
      'p97.5 ms',
      'p99 ms',
      'max ms',
      'errors',
      'timeouts',
      'non-2xx',
      'avg body',
    ]),
    row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---', '---']),
    ...report.api.map((a) =>
      row([
        a.name,
        a.phase,
        a.requests,
        a.rps.toFixed(0),
        a.p50,
        a.p95,
        a.p99,
        a.max,
        a.errors,
        a.timeouts,
        a.non2xx,
        `${(a.avgBytes / 1024).toFixed(1)} KB`,
      ]),
    ),
    '',
    `API process: CPU avg ${avg.toFixed(0)}% / max ${Math.max(0, ...cpu).toFixed(0)}% of one core; RSS max ${rss.toFixed(0)} MB; heap used max ${heap.toFixed(0)} MB.`,
    `MongoDB commands failed (by code, incl. transaction retries): ${JSON.stringify(report.server.at(-1)?.failedCommands ?? {})}`,
    `Failed sends by code: ${JSON.stringify(report.errorCodes)}`,
    `Driver event-loop delay p99: ${report.driverLagP99Ms.toFixed(1)} ms (high = the driver itself was the bottleneck).`,
  ];
  return lines.join('\n');
}
