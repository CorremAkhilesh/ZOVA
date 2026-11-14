/** What the load-test driver (`local.ts`) and the API process (`server.ts`) say to each other. */

export interface Seat {
  userId: string;
  cookie: string;
  chats: Array<{ id: string; kind: 'direct' | 'group' }>;
}

export interface ServerStats {
  at: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssMb: number;
  heapUsedMb: number;
  sockets: number;
  /** MongoDB commands that failed so far, by code name (WriteConflict = transaction retries). */
  failedCommands: Record<string, number>;
}

export type ServerMessage =
  | { type: 'ready'; seats: Seat[]; seedMs: number }
  | { type: 'stats'; stats: ServerStats };
