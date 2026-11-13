import type { Draft } from '@zuvo/protocol';
import { useEffect, useRef, useState } from 'react';
import { pushDraft } from '@/features/drafts/draft-sync';
import { useMessageUi } from '@/features/messages/store';
import type { LocalDb } from '@/features/sync/local-db';
import { useLive } from '@/features/sync/use-live';
import { useLocalDb } from './queries';

const DRAFT_SAVE_MS = 300;

/** Drafts used to live in their own table on this device only: move one onto the chat's row. */
async function adoptLegacyDraft(db: LocalDb, chatId: string) {
  const old = await db.drafts.get(chatId);
  if (!old) return;
  await db.drafts.delete(chatId);
  if (!old.text.trim()) return;
  const draft: Draft = { text: old.text, replyTo: null, updatedAt: new Date().toISOString() };
  await db.chats.update(chatId, { draft });
  await pushDraft(db, chatId);
}

/**
 * The draft of one chat: its text and the reply being written. Kept on the chat's row in Dexie (so a
 * sign-out wipes it, and the chat list shows it), and on my other devices through the server, where
 * the newest write wins. A newer draft from elsewhere replaces this one unless I am typing.
 */
export function useDraft(chatId: string) {
  const db = useLocalDb();
  const [text, setText] = useState('');
  const latest = useRef({ text: '', dirty: false });
  /** The reply as last saved or received, by message id: tells my changes from echoes. */
  const replyId = useRef<string | null>(null);
  const reply = useMessageUi((state) => state.replies[chatId]);
  const stored = useLive(
    async () => (db ? ((await db.chats.get(chatId))?.draft ?? null) : null),
    [db, chatId],
  );

  // From the server or another device (or first load): taken unless something unsaved is here.
  useEffect(() => {
    if (stored === undefined || latest.current.dirty) return;
    if (stored === null && db) void adoptLegacyDraft(db, chatId);
    const incoming: Draft | null = stored;
    const next = incoming?.text ?? '';
    if (next !== latest.current.text) {
      latest.current = { text: next, dirty: false };
      setText(next);
    }
    const quote = incoming?.replyTo ?? null;
    if ((quote?.id ?? null) !== replyId.current) {
      replyId.current = quote?.id ?? null;
      useMessageUi.getState().setReply(chatId, quote ?? undefined);
    }
  }, [chatId, db, stored]);

  const save = () => {
    if (!latest.current.dirty || !db) return;
    latest.current.dirty = false;
    const replyTo = useMessageUi.getState().replies[chatId] ?? null;
    replyId.current = replyTo?.id ?? null;
    const draft: Draft = {
      text: latest.current.text,
      replyTo,
      updatedAt: new Date().toISOString(),
    };
    void db.chats
      .update(chatId, { draft })
      .then(() => pushDraft(db, chatId))
      .catch(() => undefined);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), DRAFT_SAVE_MS);
  };

  // Starting or dropping a reply is part of the draft too.
  useEffect(() => {
    if ((reply?.id ?? null) === replyId.current) return;
    latest.current.dirty = true;
    schedule();
  });

  // Leaving the chat saves right away rather than waiting for the timer.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      saveRef.current();
    },
    [],
  );

  return {
    text,
    update(next: string) {
      setText(next);
      latest.current = { text: next, dirty: true };
      schedule();
    },
  };
}
