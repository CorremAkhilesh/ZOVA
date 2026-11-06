import { useEffect, useRef, useState } from 'react';
import { useLocalDb } from './queries';

const DRAFT_SAVE_MS = 300;

/** A draft per chat, in Dexie, so a sign-out wipes it with everything else. */
export function useDraft(chatId: string) {
  const db = useLocalDb();
  const [text, setText] = useState('');
  const latest = useRef({ text: '', dirty: false });

  useEffect(() => {
    let cancelled = false;
    void db?.drafts
      .get(chatId)
      .then((draft) => {
        if (!cancelled && draft && !latest.current.dirty) setText(draft.text);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chatId, db]);

  const save = () => {
    if (!latest.current.dirty) return;
    latest.current.dirty = false;
    const { text: value } = latest.current;
    const write = async () => {
      if (value) await db?.drafts.put({ chatId, text: value });
      else await db?.drafts.delete(chatId);
    };
    void write().catch(() => undefined);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
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
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveRef.current(), DRAFT_SAVE_MS);
    },
  };
}
