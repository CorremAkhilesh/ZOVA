import { createHmac } from 'node:crypto';
import type { IceResponse } from '@zuvo/protocol';

export interface IceEnv {
  CALLS_STUN_URLS: string[];
  CALLS_TURN_URLS: string[];
  CALLS_TURN_SECRET?: string | undefined;
  CALLS_TURN_TTL_SECONDS: number;
}

/**
 * TURN REST API credentials (coturn `use-auth-secret`): the username is `<expiry>:<user id>` and the
 * password is base64(HMAC-SHA1(secret, username)). The TURN server checks both on its own, with the
 * same secret, and refuses them once the expiry (unix seconds) has passed. The secret never leaves
 * the server.
 */
export function turnCredentials(secret: string, userId: string, expiresAt: number) {
  const username = `${expiresAt}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/** The ICE servers for one person's call: STUN, and TURN with fresh credentials when configured. */
export function iceServersFor(env: IceEnv, userId: string, now = Date.now()): IceResponse {
  const iceServers: IceResponse['iceServers'] = [];
  if (env.CALLS_STUN_URLS.length > 0) iceServers.push({ urls: env.CALLS_STUN_URLS });
  if (env.CALLS_TURN_URLS.length === 0 || !env.CALLS_TURN_SECRET) {
    return { iceServers, ttlSeconds: 0 };
  }
  const expiresAt = Math.floor(now / 1000) + env.CALLS_TURN_TTL_SECONDS;
  iceServers.push({
    urls: env.CALLS_TURN_URLS,
    ...turnCredentials(env.CALLS_TURN_SECRET, userId, expiresAt),
  });
  return { iceServers, ttlSeconds: env.CALLS_TURN_TTL_SECONDS };
}
