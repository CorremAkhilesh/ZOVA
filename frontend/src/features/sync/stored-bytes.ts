import type { LocalDb, StoredBytes } from './local-db';

const PROBE_KEY = '__can-store-blobs__';
const answers = new WeakMap<LocalDb, Promise<boolean>>();

/**
 * Safari's private windows refuse to keep a Blob in IndexedDB, while accepting the same bytes as an
 * ArrayBuffer. A real write is the only reliable way to tell.
 */
function canStoreBlobs(db: LocalDb): Promise<boolean> {
  let answer = answers.get(db);
  if (!answer) {
    answer = db.files
      .put({ clientMsgId: PROBE_KEY, file: new Blob(['x']) })
      .then(() => db.files.delete(PROBE_KEY))
      .then(() => true)
      .catch(() => false);
    answers.set(db, answer);
  }
  return answer;
}

/** In whichever form this browser can keep. Call outside a transaction: it may read the file. */
export async function toStorable(db: LocalDb, blob: Blob): Promise<StoredBytes> {
  if (await canStoreBlobs(db)) return blob;
  return { bytes: await blob.arrayBuffer(), type: blob.type };
}

export const asBlob = (stored: StoredBytes): Blob =>
  'slice' in stored ? stored : new Blob([stored.bytes], { type: stored.type });
