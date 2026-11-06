import type { Env } from '../config/env.ts';

/** Where this process keeps its data, with no passwords. See "Sharing a machine" in the README. */
export function describeConnections(env: Pick<Env, 'MONGODB_DB' | 'REDIS_URL'>) {
  let redis = 'none';
  if (env.REDIS_URL) {
    try {
      const { hostname, port } = new URL(env.REDIS_URL);
      redis = `${hostname}:${port || '6379'}`;
    } catch {
      redis = 'invalid url';
    }
  }
  return { mongodbDb: env.MONGODB_DB, redis };
}

export function connectionsLine(env: Pick<Env, 'MONGODB_DB' | 'REDIS_URL'>): string {
  const { mongodbDb, redis } = describeConnections(env);
  return `Using MONGODB_DB=${mongodbDb} and Redis ${redis}`;
}
