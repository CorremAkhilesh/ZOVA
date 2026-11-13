import { describe, expect, it } from 'vitest';
import { connectionsLine, describeConnections } from './connections.ts';

describe('the startup line', () => {
  it('names the database and Redis address', () => {
    expect(
      connectionsLine({ MONGODB_DB: 'zuvo_dev7', REDIS_URL: 'redis://:s3cret@127.0.0.1:6391' }),
    ).toBe('Using MONGODB_DB=zuvo_dev7 and Redis 127.0.0.1:6391');
  });

  it('never contains the password', () => {
    const line = connectionsLine({
      MONGODB_DB: 'zuvo_dev7',
      REDIS_URL: 'rediss://user:s3cret@redis.example:6380/2',
    });
    expect(line).toContain('redis.example:6380');
    expect(line).not.toContain('s3cret');
    expect(line).not.toContain('user');
  });

  it('says so when there is no Redis, and fills in the default port', () => {
    expect(describeConnections({ MONGODB_DB: 'a', REDIS_URL: undefined }).redis).toBe('none');
    expect(describeConnections({ MONGODB_DB: 'a', REDIS_URL: 'redis://h' }).redis).toBe('h:6379');
  });

  it('does not repeat a malformed address, which could hold a password', () => {
    const { redis } = describeConnections({ MONGODB_DB: 'a', REDIS_URL: 'not a url s3cret' });
    expect(redis).toBe('invalid url');
  });
});
