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

/** The store, on this device's IndexedDB (the service worker's and the page's are the same). */
export function indexedDbShareStore(factory: IDBFactory = indexedDB): ShareStore {
  return {
    put: async (item) => {
      await run(factory, 'readwrite', (store) => store.put(item));
    },
    get: async (id) =>
      (await run<SharedItem>(factory, 'readonly', (store) => store.get(id))) ?? undefined,
    latest: async () => {
      const all = (await run<SharedItem[]>(factory, 'readonly', (store) => store.getAll())) ?? [];
      return all.sort((a, b) => b.createdAt - a.createdAt)[0];
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
