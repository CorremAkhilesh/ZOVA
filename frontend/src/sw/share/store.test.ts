import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { indexedDbShareStore, SHARE_TTL_MS, type SharedItem } from './store';

const item = (id: string, createdAt: number): SharedItem => ({
  id,
  createdAt,
  title: '',
  text: id,
  url: '',
  files: [{ name: `${id}.txt`, type: 'text/plain', size: 2, blob: new Blob(['hi']) }],
});

describe('shares waiting on this device', () => {
  it('keeps them by id, finds the newest, deletes after use, and clears day-old ones', async () => {
    const store = indexedDbShareStore();
    const now = Date.now();
    await store.put(item('old', now - SHARE_TTL_MS - 1));
    await store.put(item('a', now - 1000));
    await store.put(item('b', now));
    expect((await store.get('a'))?.text).toBe('a');
    expect((await store.latest())?.id).toBe('b');
    expect((await store.get('b'))?.files[0]).toMatchObject({ name: 'b.txt', size: 2 });

    await store.prune(now - SHARE_TTL_MS);
    expect(await store.get('old')).toBeUndefined();
    expect(await store.get('a')).toBeDefined();

    await store.remove('b');
    expect(await store.get('b')).toBeUndefined();
    expect((await store.latest())?.id).toBe('a');
  });
});
