/**
 * Shared items ("Share to Zuvo"), waiting for the /share page: kept in their own small IndexedDB
 * database on this device only, read by the page once and deleted right after use. Anything older
 * than a day is deleted too, so nothing shared lingers. Used by the service worker and the page.
 */

export interface SharedFile {
  name: string;
  type: string;
  size: number;
  blob: Blob;
}

export interface SharedItem {
  id: string;
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: SharedFile[];
}

export interface ShareStore {
  put(item: SharedItem): Promise<void>;
  get(id: string): Promise<SharedItem | undefined>;
  latest(): Promise<SharedItem | undefined>;
  remove(id: string): Promise<void>;
  /** Deletes everything created before `before` (ms). */
  prune(before: number): Promise<void>;
}

export const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const DB_NAME = 'zuvo-share';
const STORE = 'shares';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  return open(factory).then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request?.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

/** Older than a day: never handed out, whether or not a prune has run since. */
const fresh = (item: SharedItem) => item.createdAt >= Date.now() - SHARE_TTL_MS;

/** Sign-out: everything shared into the app and not sent goes with the rest of the user's data. */
export function deleteShareDatabase(factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve) => {
    const request = factory.deleteDatabase(DB_NAME);
    // Blocked or failed: the items still expire within a day, and are not handed out after that.
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** The store, on this device's IndexedDB (the service worker's and the page's are the same). */
export function indexedDbShareStore(factory: IDBFactory = indexedDB): ShareStore {
  return {
    put: async (item) => {
      await run(factory, 'readwrite', (store) => store.put(item));
    },
    get: async (id) => {
      const item = await run<SharedItem>(factory, 'readonly', (store) => store.get(id));
      return item && fresh(item) ? item : undefined;
    },
    latest: async () => {
      const all = (await run<SharedItem[]>(factory, 'readonly', (store) => store.getAll())) ?? [];
      return all.filter(fresh).sort((a, b) => b.createdAt - a.createdAt)[0];
    },
    remove: async (id) => {
      await run(factory, 'readwrite', (store) => store.delete(id));
    },
    prune: async (before) => {
      await run(factory, 'readwrite', (store) => {
        store.index('createdAt').openCursor(IDBKeyRange.upperBound(before, true)).onsuccess = (
          event,
        ) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        return undefined;
      });
    },
  };
}
