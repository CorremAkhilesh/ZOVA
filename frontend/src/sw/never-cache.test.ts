import { describe, expect, it } from 'vitest';
import { isNeverCached } from './never-cache';

describe('service worker never-cache list', () => {
  it.each([
    '/v1',
    '/v1/health',
    '/v1/chats/abc/messages',
    '/socket.io/',
    '/socket.io/?EIO=4',
    '/media/ab/cd/x',
  ])('never serves %s from the service worker', (path) => {
    expect(isNeverCached(path)).toBe(true);
  });

  it.each(['/', '/chats', '/chats/asha', '/settings', '/v1x', '/mediafile', '/assets/index.js'])(
    'lets the app shell handle %s',
    (path) => {
      expect(isNeverCached(path)).toBe(false);
    },
  );
});
