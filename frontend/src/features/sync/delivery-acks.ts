import { liveQuery } from 'dexie';
import type { ChatRow, LocalDb } from './local-db';

/** Messages often arrive in bursts: one acknowledgement covers them all. */
const BATCH_MS = 500;

interface DeliveryAcksOptions {
  db: LocalDb;
  me: string;
  isConnected: () => boolean;
  /** Resolves true once the server has it. */
  send: (chatId: string, seq: number) => Promise<boolean>;
  batchMs?: number;
}

/**
 * Tells the server what this device has stored, whether it came live or through sync. Watching the
 * database covers every way a message can arrive. The last message being mine needs no ack: sending
 * already counts as having received everything before it.
 */
export function startDeliveryAcks({
  db,
  me,
  isConnected,
  send,
  batchMs = BATCH_MS,
}: DeliveryAcksOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const inFlight = new Set<string>();

  const needsAck = (chat: ChatRow) =>
    chat.type === 'direct' &&
    Boolean(chat.lastMessage) &&
    chat.lastMessage?.senderId !== me &&
    chat.seq > (chat.ackedDeliveredSeq ?? 0);

  async function flush() {
    timer = undefined;
    if (stopped || !isConnected()) return;
    const chats = await db.chats.filter(needsAck).toArray();
    await Promise.all(
      chats
        .filter((chat) => !inFlight.has(chat.id))
        .map(async ({ id, seq }) => {
          inFlight.add(id);
          try {
            if (await send(id, seq)) await db.chats.update(id, { ackedDeliveredSeq: seq });
          } finally {
            inFlight.delete(id);
          }
        }),
    );
  }

  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => void flush().catch(() => undefined), batchMs);
  };

  const subscription = liveQuery(() => db.chats.filter(needsAck).count()).subscribe({
    next: (count) => {
      if (count > 0) schedule();
    },
    error: () => undefined,
  });

  return {
    /** The connection is back. */
    resume: schedule,
    stop() {
      stopped = true;
      clearTimeout(timer);
      subscription.unsubscribe();
    },
  };
}
