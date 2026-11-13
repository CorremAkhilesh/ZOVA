/**
 * Files this browser has no room to keep in IndexedDB. They still upload, but only from this tab and
 * only while it stays open, so nothing can resume them after a reload. A File here is only a handle
 * to the one on disk: holding it costs no memory.
 */
export interface HeldFile {
  file: Blob;
  poster?: Blob | undefined;
  release: () => void;
}

const LOCK_PREFIX = 'zuvo-held-file:';
const held = new Map<string, HeldFile>();

const askBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();

/** A lock goes when its tab does, however that tab ends, which tells other tabs the file is gone. */
function lockUntilReleased(clientMsgId: string): () => void {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  void navigator.locks?.request(`${LOCK_PREFIX}${clientMsgId}`, () => released).catch(() => {});
  return release;
}

export function holdFile(clientMsgId: string, file: Blob, poster?: Blob): void {
  if (held.size === 0) window.addEventListener('beforeunload', askBeforeLeaving);
  held.set(clientMsgId, { file, poster, release: lockUntilReleased(clientMsgId) });
}

export const heldFile = (clientMsgId: string) => held.get(clientMsgId);

export function releaseFile(clientMsgId: string): void {
  held.get(clientMsgId)?.release();
  held.delete(clientMsgId);
  if (held.size === 0) window.removeEventListener('beforeunload', askBeforeLeaving);
}

export function releaseAllFiles(): void {
  for (const clientMsgId of [...held.keys()]) releaseFile(clientMsgId);
}

export async function heldByAnotherTab(clientMsgId: string): Promise<boolean> {
  const name = `${LOCK_PREFIX}${clientMsgId}`;
  const state = await navigator.locks?.query().catch(() => undefined);
  return [...(state?.held ?? []), ...(state?.pending ?? [])].some((lock) => lock.name === name);
}
