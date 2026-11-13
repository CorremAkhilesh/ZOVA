import type { AppSocket } from './client';
import { type LocalDb, type MessageRow, PENDING_ORDER_BASE } from './local-db';
import { ACK_TIMEOUT_MS } from './socket-transport';

const UNREPORTED = 'unreported-plays';

interface Play {
  chatId: string;
  messageId: string;
}

async function unreported(db: LocalDb): Promise<Play[]> {
  const stored = await db.meta.get(UNREPORTED);
  return stored ? (JSON.parse(stored.value) as Play[]) : [];
}

const save = (db: LocalDb, plays: Play[]) =>
  plays.length
    ? db.meta.put({ key: UNREPORTED, value: JSON.stringify(plays) })
    : db.meta.delete(UNREPORTED);

/** Answers to a report. `null` means no answer, so the report waits for the next connection. */
export type SendPlay = (play: Play) => Promise<'done' | null>;

/**
 * Plays heard here and not yet told to the server. Written first, so the dot goes at once, and a play
 * heard offline, or just before closing the tab, still gets reported.
 */
export function createPlayReports(db: LocalDb, send: SendPlay) {
  let running = false;

  async function flush() {
    if (running) return;
    running = true;
    try {
      for (const play of await unreported(db)) {
        const answer = await send(play);
        if (answer === null) return;
        const rest = (await unreported(db)).filter((item) => item.messageId !== play.messageId);
        await save(db, rest);
      }
    } finally {
      running = false;
    }
  }

  return {
    flush,
    async record(key: string, chatId: string, messageId: string) {
      await db.transaction('rw', db.messages, db.meta, async () => {
        await db.messages.update(key, { played: true });
        const plays = await unreported(db);
        if (!plays.some((play) => play.messageId === messageId)) {
          await save(db, [...plays, { chatId, messageId }]);
        }
      });
      await flush();
    },
  };
}

/** Reports go over the socket. A refusal will never turn into a yes, so it is not asked again. */
export const socketPlayReports = (db: LocalDb, socket: AppSocket) =>
  createPlayReports(db, async (play) => {
    if (!socket.connected) return null;
    const ack = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('voice:played', play)
      .catch(() => null);
    return ack ? 'done' : null;
  });

/** The message right after this one, if it has reached the server. */
export async function messageAfter(db: LocalDb, key: string): Promise<MessageRow | null> {
  const row = await db.messages.get(key);
  if (!row) return null;
  const next = await db.messages
    .where('[chatId+order]')
    .between([row.chatId, row.order], [row.chatId, PENDING_ORDER_BASE], false, false)
    .first();
  return next ?? null;
}
