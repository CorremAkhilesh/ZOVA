import Dexie from 'dexie';
import { chatsApi } from '@/features/chats/api';
import { applyHistory } from './apply';
import { type LocalDb, PENDING_ORDER_BASE } from './local-db';

/**
 * Self-healing: a chat says how far it goes (`seq`); the messages stored here should go that far,
 * without holes. Whatever the cause (a lost event, a failed write, an older version's bug), a hole is
 * fetched from the server (GET /v1/chats/:id/messages?after=&before=, an indexed range) and filled.
 * Positions the server does not return (deleted for me, expired, before I joined) are remembered as
 * absent, so they are never asked for again. Nothing is asked when nothing is missing.
 */

/** How many of the newest stored messages are checked for holes. */
const WINDOW = 300;
/** At most this many requests per check. */
const MAX_FETCHES = 4;
/** The same chat at the same `seq` is checked at most this often. */
const RECHECK_MS = 15_000;
/** On focus or reconnect: the most recent chats checked. */
const RECENT_CHATS = 10;

export interface Hole {
  /** Exclusive bounds: the missing positions lie strictly between. */
  after: number;
  before: number;
}

/**
 * The holes in `stored` (ascending positions) and above it up to `latest`, leaving out positions
 * known to be absent. Pure.
 */
export function findHoles(stored: number[], latest: number, absent: ReadonlySet<number>): Hole[] {
  if (stored.length === 0) return [];
  const holes: Hole[] = [];
  const add = (from: number, to: number) => {
    let low = from;
    let high = to;
    while (low <= high && absent.has(low)) low += 1;
    while (high >= low && absent.has(high)) high -= 1;
    if (low <= high) holes.push({ after: low - 1, before: high + 1 });
  };
  for (let index = 1; index < stored.length; index++) {
    const previous = stored[index - 1] ?? 0;
    const current = stored[index] ?? 0;
    if (current - previous > 1) add(previous + 1, current - 1);
  }
  const top = stored.at(-1) ?? 0;
  if (latest > top) add(top + 1, latest);
  return holes;
}

type RangeApi = Pick<typeof chatsApi, 'range'>;

const absentByChat = new Map<string, Set<number>>();
const checked = new Map<string, { seq: number; at: number }>();

/** Forget what was learned (a new session on this page, or tests). */
export function resetGapMemory() {
  absentByChat.clear();
  checked.clear();
}

async function storedPositions(db: LocalDb, chatId: string): Promise<number[]> {
  const rows = await db.messages
    .where('[chatId+order]')
    .between([chatId, Dexie.minKey], [chatId, PENDING_ORDER_BASE], true, false)
    .reverse()
    .limit(WINDOW)
    .toArray();
  return rows.flatMap((row) => (row.seq === null ? [] : [row.seq])).reverse();
}

/**
 * One hole, page by page (each page is the newest part of what is left), at most `budget` requests.
 * Positions the server skipped are added to `absent`. Returns [messages stored, requests made].
 */
async function fillHole(
  db: LocalDb,
  me: string,
  chatId: string,
  hole: Hole,
  context: { api: RangeApi; absent: Set<number>; budget: number },
): Promise<[number, number]> {
  let before = hole.before;
  let fetched = 0;
  let requests = 0;
  while (requests < context.budget && before - hole.after > 1) {
    requests += 1;
    const page = await context.api.range(chatId, hole.after, before);
    await applyHistory(db, me, page.items);
    fetched += page.items.length;
    const got = new Set(page.items.map((item) => item.seq));
    const lowest = page.hasMore ? (page.items[0]?.seq ?? before) : hole.after + 1;
    for (let seq = lowest; seq < before; seq++) if (!got.has(seq)) context.absent.add(seq);
    if (!page.hasMore || page.items.length === 0) break;
    before = lowest;
  }
  return [fetched, requests];
}

/**
 * Checks one chat and fills what is missing. Returns how many messages came back. `force` skips the
 * recheck pause (opening a chat).
 */
export async function fillGaps(
  db: LocalDb,
  me: string,
  chatId: string,
  options: { api?: RangeApi; force?: boolean; now?: number } = {},
): Promise<number> {
  const { api = chatsApi, now = Date.now() } = options;
  const chat = await db.chats.get(chatId);
  if (!chat) return 0;
  const last = checked.get(chatId);
  if (!options.force && last && last.seq === chat.seq && now - last.at < RECHECK_MS) return 0;
  checked.set(chatId, { seq: chat.seq, at: now });
  const absent = absentByChat.get(chatId) ?? new Set<number>();
  absentByChat.set(chatId, absent);
  let fetched = 0;
  let budget = MAX_FETCHES;
  for (const hole of findHoles(await storedPositions(db, chatId), chat.seq, absent)) {
    if (budget <= 0) break;
    const [stored, used] = await fillHole(db, me, chatId, hole, { api, absent, budget });
    fetched += stored;
    budget -= used;
  }
  return fetched;
}

/** The most recent chats whose stored messages fall short of their `seq`: checked and filled. */
export async function fillRecentGaps(db: LocalDb, me: string, api?: RangeApi): Promise<number> {
  const chats = await db.chats.orderBy('sortAt').reverse().limit(RECENT_CHATS).toArray();
  let fetched = 0;
  for (const chat of chats) {
    fetched += await fillGaps(db, me, chat.id, api ? { api } : {});
  }
  return fetched;
}
