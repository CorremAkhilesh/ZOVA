/**
 * Runs inside the page (page.evaluate): writes chats and messages straight into the signed-in
 * user's IndexedDB, so the numbers measure the app rather than the server. Self-contained on
 * purpose — Playwright serializes the function.
 */
export interface SeedOptions {
  /** The user's database, e.g. zuvo-user-<id>. */
  name: string;
  chats: number;
  messages: number;
  /** The chat that gets every message (it is also the newest). */
  chatId: string;
}

export async function seedDatabase({ name, chats, messages, chatId }: SeedOptions): Promise<void> {
  const request = indexedDB.open(name);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(['chats', 'messages'], 'readwrite');
  const now = Date.now();
  const id = (n: number, pad: string) => n.toString(16).padStart(24, pad);
  for (let n = 1; n <= chats; n++) {
    const at = new Date(now - n * 60_000).toISOString();
    const long = n === 1;
    const seq = long ? messages : 1;
    tx.objectStore('chats').put({
      id: long ? chatId : id(n, '0'),
      type: 'direct',
      seq,
      otherUser: {
        id: id(n, 'b'),
        displayName: `Colleague ${n}`,
        username: `colleague${n}`,
        about: null,
        avatar: null,
        deactivated: false,
      },
      lastMessage: {
        id: id(n, 'c'),
        seq,
        senderId: id(n, 'b'),
        type: 'text',
        preview: `The last thing said in chat number ${n}`,
        createdAt: at,
      },
      lastReadSeq: seq,
      // Some unread badges, as a real list has.
      unreadCount: n % 9 === 0 ? n % 13 : 0,
      peerDeliveredSeq: seq,
      peerReadSeq: seq,
      lastActivityAt: at,
      createdAt: at,
      sortAt: Date.parse(at),
    });
  }
  const other = id(1, 'b');
  for (let seq = 1; seq <= messages; seq++) {
    const mine = seq % 4 === 0;
    tx.objectStore('messages').put({
      key: `perf-${seq}`,
      id: id(seq, 'd'),
      chatId,
      seq,
      order: seq,
      clientMsgId: null,
      senderId: mine ? 'me' : other,
      type: 'text',
      text: `Message number ${seq}${seq % 7 === 0 ? ', a longer one that wraps onto a second line in the bubble for a more honest layout test.' : ''}`,
      media: null,
      albumId: null,
      played: false,
      replyToId: null,
      editedAt: null,
      deletedForEveryoneAt: null,
      createdAt: new Date(now - (messages - seq) * 60_000).toISOString(),
      status: 'sent',
    });
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
