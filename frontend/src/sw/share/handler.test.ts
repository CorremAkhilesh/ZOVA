import { describe, expect, it, vi } from 'vitest';
import { handleShareTarget, readShare, SHARE_FILES_MAX, safeFileName } from './handler';
import { SHARE_TTL_MS, type SharedItem, type ShareStore } from './store';

const ORIGIN = 'https://app.example.test';
const NOW = 1_800_000_000_000;

function memoryStore() {
  const items = new Map<string, SharedItem>();
  const store: ShareStore & { items: Map<string, SharedItem> } = {
    items,
    put: vi.fn(async (item: SharedItem) => {
      items.set(item.id, item);
    }),
    get: async (id) => items.get(id),
    latest: async () => [...items.values()].sort((a, b) => b.createdAt - a.createdAt)[0],
    remove: async (id) => {
      items.delete(id);
    },
    prune: vi.fn(async () => undefined),
  };
  return store;
}

const deps = (store: ShareStore) => ({
  store,
  now: () => NOW,
  randomId: () => 'share-1',
  origin: ORIGIN,
});

/** A request as the service worker sees it (jsdom's FormData cannot be posted through fetch's). */
function post(form: FormData, url = `${ORIGIN}/share-target`) {
  return { url, method: 'POST', formData: async () => form } as unknown as Request;
}

describe('file names from other apps', () => {
  it('keeps only the name: no folders, no control or reserved characters, never empty', () => {
    expect(safeFileName('../../etc/passwd', 0)).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\report.pdf', 0)).toBe('report.pdf');
    expect(safeFileName('bad\u0000na<me>?.txt', 0)).toBe('badname.txt');
    expect(safeFileName('...hidden', 0)).toBe('hidden');
    expect(safeFileName('', 2)).toBe('file-3');
    expect(Array.from(safeFileName(`${'é'.repeat(300)}.png`, 0))).toHaveLength(200);
  });
});

describe('what a share holds', () => {
  it('files (named safely, empty ones dropped, at most the limit) and trimmed text', () => {
    const form = new FormData();
    form.append('files', new File(['a'], 'a/photo.jpg', { type: 'image/jpeg' }));
    form.append('files', new File([], 'empty.txt'));
    form.append('files', new File(['%PDF'], 'plan.pdf'));
    form.append('text', '  hello  ');
    form.append('url', 'https://example.test/x');
    const item = readShare(form, 'id', NOW);
    expect(item.files.map((file) => [file.name, file.type, file.size])).toEqual([
      ['photo.jpg', 'image/jpeg', 1],
      ['plan.pdf', 'application/octet-stream', 4],
    ]);
    expect(item).toMatchObject({ id: 'id', createdAt: NOW, text: 'hello', title: '' });
    const many = new FormData();
    for (let i = 0; i < SHARE_FILES_MAX + 5; i++) many.append('files', new File(['x'], `${i}.txt`));
    expect(readShare(many, 'id', NOW).files).toHaveLength(SHARE_FILES_MAX);
  });
});

describe('POST /share-target in the service worker', () => {
  it('stores the share, clears day-old ones, and sends the window to /share (303)', async () => {
    const store = memoryStore();
    const form = new FormData();
    form.append('files', new File(['a'], 'one.png', { type: 'image/png' }));
    form.append('files', new File(['b'], 'two.pdf', { type: 'application/pdf' }));
    form.append('text', 'From Files');
    const response = await handleShareTarget(deps(store), post(form));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/share?id=share-1`);
    expect(store.items.get('share-1')?.files).toHaveLength(2);
    expect(store.prune).toHaveBeenCalledWith(NOW - SHARE_TTL_MS);
  });

  it('another origin, or a form it cannot read, goes to /share with an error and stores nothing', async () => {
    const store = memoryStore();
    const foreign = await handleShareTarget(
      deps(store),
      post(new FormData(), 'https://evil.example/share-target'),
    );
    expect(foreign.headers.get('location')).toBe(`${ORIGIN}/share?error=1`);
    const unreadable = {
      url: `${ORIGIN}/share-target`,
      method: 'POST',
      formData: () => Promise.reject(new TypeError('bad body')),
    } as unknown as Request;
    const broken = await handleShareTarget(deps(store), unreadable);
    expect(broken.status).toBe(303);
    expect(broken.headers.get('location')).toBe(`${ORIGIN}/share?error=1`);
    expect(store.put).not.toHaveBeenCalled();
  });
});
