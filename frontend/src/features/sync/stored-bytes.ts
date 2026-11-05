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

/** Not worth loading into memory just to store it. */
const MAX_BYTES_IN_MEMORY = 64 * 1024 * 1024;
/** The estimate is rough, and a full browser store fails everything else too. */
const QUOTA_MARGIN = 1.1;

async function hasRoomFor(bytes: number): Promise<boolean> {
  try {
    const { quota, usage = 0 } = await navigator.storage.estimate();
    return quota === undefined || quota - usage >= bytes * QUOTA_MARGIN;
  } catch {
    // The browser cannot say. Trying to store it will tell.
    return true;
  }
}

/** True when a file of this size cannot be kept here for a resumable upload. */
export async function mustHold(db: LocalDb, bytes: number): Promise<boolean> {
  if (!(await hasRoomFor(bytes))) return true;
  return bytes > MAX_BYTES_IN_MEMORY && !(await canStoreBlobs(db));
}

/** Dexie reports a full store either directly or as the reason a transaction was aborted. */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const inner = 'inner' in error ? (error.inner as { name?: string } | null) : null;
  return error.name === 'QuotaExceededError' || inner?.name === 'QuotaExceededError';
}

/** In whichever form this browser can keep. Call outside a transaction: it may read the file. */
export async function toStorable(db: LocalDb, blob: Blob): Promise<StoredBytes> {
  if (await canStoreBlobs(db)) return blob;
  return { bytes: await blob.arrayBuffer(), type: blob.type };
}

export const asBlob = (stored: StoredBytes): Blob =>
  'slice' in stored ? stored : new Blob([stored.bytes], { type: stored.type });
