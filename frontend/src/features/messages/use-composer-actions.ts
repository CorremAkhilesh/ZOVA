import { EDIT_WINDOW_MINUTES, type Mention } from '@zuvo/protocol';
import Dexie from 'dexie';
import { type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';
import { useSession } from '@/features/auth/session';
import { useLocalDb } from '@/features/chats/queries';
import type { LocalDb } from '@/features/sync/local-db';
import { PENDING_ORDER_BASE } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { useMessageUi } from './store';

/** My newest message that can still be edited. */
async function lastEditable(db: LocalDb, chatId: string, me: string) {
  const rows = await db.messages
    .where('[chatId+order]')
    .between([chatId, Dexie.minKey], [chatId, PENDING_ORDER_BASE], true, false)
    .reverse()
    .limit(50)
    .toArray();
  const oldest = Date.now() - EDIT_WINDOW_MINUTES * 60_000;
  return rows.find(
    (row) =>
      row.senderId === me &&
      row.id !== null &&
      row.seq !== null &&
      !row.deletedForEveryoneAt &&
      row.media?.kind !== 'voice' &&
      !row.system &&
      Date.parse(row.createdAt) > oldest,
  );
}

/** What the composer does for a reply or an edit: the text moves in, and back out afterwards. */
export function useComposerActions(
  chatId: string,
  text: string,
  update: (next: string) => void,
  field: RefObject<HTMLTextAreaElement | null>,
) {
  const db = useLocalDb();
  const me = useSession()?.user.id ?? '';
  const editing = useMessageUi((state) =>
    state.editing?.chatId === chatId ? state.editing : null,
  );
  const reply = useMessageUi((state) => state.replies[chatId]);
  const stash = useRef<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const editKey = editing?.messageId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: one message's edit starts once
  useEffect(() => {
    if (editKey && editing) {
      stash.current = textRef.current;
      update(editing.text);
      field.current?.focus();
    } else if (stash.current !== null) {
      update(stash.current);
      stash.current = null;
    }
  }, [editKey]);
  useEffect(() => {
    if (reply) field.current?.focus();
  }, [field, reply]);

  return {
    editing,
    /** True when this send was an edit, which is then finished. */
    finishEdit(mentions: { mentions?: Mention[]; mentionsEveryone?: boolean } = {}) {
      if (!editing) return false;
      const { client } = useSyncStore.getState();
      if (textRef.current !== editing.text) {
        void client?.act({ type: 'edit', ...editing, text: textRef.current, ...mentions });
      }
      useMessageUi.getState().setEditing(null);
      return true;
    },
    takeReply() {
      const quote = useMessageUi.getState().replies[chatId];
      if (quote) useMessageUi.getState().setReply(chatId, undefined);
      return quote ?? null;
    },
    /** Up arrow in an empty composer edits my last message. */
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key !== 'ArrowUp' || textRef.current || editing || !db) return false;
      event.preventDefault();
      void lastEditable(db, chatId, me).then((row) => {
        if (row?.id && row.seq) {
          useMessageUi.getState().setEditing({
            chatId,
            messageId: row.id,
            seq: row.seq,
            text: row.text ?? '',
          });
        }
      });
      return true;
    },
  };
}
