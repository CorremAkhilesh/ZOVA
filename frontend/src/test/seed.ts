import type { ChatSummary, Message } from '@zuvo/protocol';
import { applySyncPage } from '@/features/sync/apply';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { ME_ID, savedChatFixture, syncPage } from './chat-fixtures';

/** The device as it would be after an earlier sync: chats, messages and a cursor. */
export async function seedLocal(chats: ChatSummary[], messages: Message[] = []): Promise<LocalDb> {
  const db = getUserDb(ME_ID);
  await db.open();
  await applySyncPage(
    db,
    ME_ID,
    syncPage({ cursor: '5', chats: [savedChatFixture(), ...chats], messages }),
  );
  return db;
}
