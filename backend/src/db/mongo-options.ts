import type { ConnectOptions } from 'mongoose';

/**
 * MongoDB client settings for the API and the worker (reasoning: docs/runbooks/backend-performance.md).
 *
 * - Pool: the API runs a send as one transaction of about a dozen round trips; at Atlas round-trip
 *   times (1–5 ms in-region) 20 connections carry several hundred sends a second. The worker runs
 *   a handful of jobs at a time and needs far fewer. Atlas limits connections per cluster, and every
 *   client also keeps 2 monitoring sockets per replica-set member, so the worker uses one client.
 * - Compression: zlib is built into Node (snappy/zstd need native packages). Atlas egress and
 *   history/sync pages shrink several times; tiny messages cost almost nothing to compress.
 * - Timeouts: a request should fail in seconds, not hang, when Atlas is unreachable.
 * - `monitorCommands` feeds the slow query log (src/db/slow-query.ts).
 */
export function mongoClientOptions(role: 'api' | 'worker'): ConnectOptions {
  return {
    maxPoolSize: role === 'api' ? 20 : 5,
    minPoolSize: role === 'api' ? 2 : 0,
    // An idle pooled connection is closed after this; Atlas also drops idle ones after a while.
    maxIdleTimeMS: 5 * 60_000,
    // No `waitQueueTimeoutMS`: at startup outside production every model builds its indexes at
    // once and holds connections for seconds; a wait limit failed the start (load test, Step 20).
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    compressors: ['zlib'],
    appName: role === 'api' ? 'zuvo-api' : 'zuvo-worker',
    monitorCommands: true,
  };
}
