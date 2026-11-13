import { type Draft, draftResponseSchema } from '@zuvo/protocol';
import { newerDraft } from '@/features/sync/apply';
import type { LocalDb } from '@/features/sync/local-db';
import { apiPut } from '@/lib/api-client';

/** After the last keystroke: often enough to feel live on my other devices, rare enough to be cheap. */
export const DRAFT_PUSH_MS = 1000;

export const draftsApi = {
  put: (chatId: string, draft: Draft) =>
    apiPut(`/v1/chats/${chatId}/draft`, draft, draftResponseSchema),
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Drafts that could not be sent yet (offline): sent when the socket is back. */
const waiting = new Set<string>();

/** A draft from elsewhere (another device, or the server's answer): kept only if newer. */
export async function applyRemoteDraft(db: LocalDb, chatId: string, draft: Draft | null) {
  await db.transaction('rw', db.chats, async () => {
    const row = await db.chats.get(chatId);
    if (!row) return;
    const next = newerDraft(row.draft, draft);
    if (next !== row.draft) await db.chats.put({ ...row, draft: next });
  });
}

async function send(db: LocalDb, chatId: string) {
  const draft = (await db.chats.get(chatId))?.draft;
  if (!draft) return;
  try {
    const answer = await draftsApi.put(chatId, draft);
    waiting.delete(chatId);
    // Someone else's newer draft won: show that one.
    if (!answer.applied) await applyRemoteDraft(db, chatId, answer.draft);
  } catch {
    waiting.add(chatId);
  }
}

/** This chat's draft changed here: tell the server shortly, last write wins there. */
export function pushDraft(db: LocalDb, chatId: string, delayMs = DRAFT_PUSH_MS) {
  clearTimeout(timers.get(chatId));
  timers.set(
    chatId,
    setTimeout(() => {
      timers.delete(chatId);
      void send(db, chatId).catch(() => undefined);
    }, delayMs),
  );
}

/** Back online: send what could not go before. */
export function flushDrafts(db: LocalDb) {
  for (const chatId of [...waiting]) void send(db, chatId).catch(() => undefined);
}

/** Sign-out: nothing of this user's may still be sent. */
export function forgetDrafts() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  waiting.clear();
}

/** The text a chat list shows for a draft; empty text is no draft. */
export const draftLine = (draft: Draft | null | undefined) =>
  draft?.text.trim() ? draft.text.replace(/\s+/gu, ' ').trim() : null;
