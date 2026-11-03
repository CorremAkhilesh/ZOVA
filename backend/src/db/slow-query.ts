import type { CommandStartedEvent, CommandSucceededEvent, MongoClient } from 'mongodb';

export const SLOW_QUERY_MS = 100;

/** Commands worth timing, and the field holding the collection name (= the command name). */
const QUERY_COMMANDS = new Set([
  'find',
  'aggregate',
  'count',
  'distinct',
  'update',
  'delete',
  'findAndModify',
  'insert',
]);

const MAX_DEPTH = 6;

/**
 * Keeps the structure of a filter/pipeline but replaces every value with a type marker, so logs show
 * the query shape (`{ email: '?string' }`) and never user data.
 */
export function redactShape(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    const shapes = value.slice(0, 3).map((item) => redactShape(item, depth + 1));
    return value.length > 3 ? [...shapes, `…+${value.length - 3}`] : shapes;
  }
  if (value instanceof Date) return '?date';
  if (typeof value === 'object' && value !== null) {
    if ('_bsontype' in value) return `?${String(value._bsontype).toLowerCase()}`;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactShape(child, depth + 1)]),
    );
  }
  return value === null ? '?null' : `?${typeof value}`;
}

export interface QuerySummary {
  collection: string;
  command: string;
  shape: unknown;
}

/** Collection, command and redacted shape of a query command; null for anything else. */
export function summarizeCommand(event: Pick<CommandStartedEvent, 'commandName' | 'command'>) {
  const { commandName, command } = event;
  if (!QUERY_COMMANDS.has(commandName)) return null;
  const collection = command[commandName];
  if (typeof collection !== 'string') return null;

  const firstOf = (key: 'updates' | 'deletes') => {
    const list = command[key];
    return Array.isArray(list) && list.length > 0 ? list[0].q : undefined;
  };
  const shape = {
    filter: command.filter ?? command.query ?? firstOf('updates') ?? firstOf('deletes'),
    sort: command.sort,
    pipeline: command.pipeline,
  };
  const defined = Object.fromEntries(
    Object.entries(shape).filter(([, part]) => part !== undefined),
  );
  return { collection, command: commandName, shape: redactShape(defined) } satisfies QuerySummary;
}

type SlowLogger = { warn: (object: object, message: string) => void };

/**
 * Logs every query slower than `thresholdMs`. Requires the client to be created with
 * `monitorCommands: true`. Returns a function that detaches the listeners.
 */
export function attachSlowQueryLogger(
  client: Pick<MongoClient, 'on' | 'off'>,
  logger: SlowLogger,
  thresholdMs = SLOW_QUERY_MS,
): () => void {
  const pending = new Map<number, QuerySummary>();

  const onStarted = (event: CommandStartedEvent) => {
    const summary = summarizeCommand(event);
    if (summary) pending.set(event.requestId, summary);
  };
  const onFinished = (event: Pick<CommandSucceededEvent, 'requestId' | 'duration'>) => {
    const summary = pending.get(event.requestId);
    if (!summary) return;
    pending.delete(event.requestId);
    if (event.duration >= thresholdMs) {
      logger.warn({ ...summary, durationMs: Math.round(event.duration) }, 'slow mongodb query');
    }
  };

  client.on('commandStarted', onStarted);
  client.on('commandSucceeded', onFinished);
  client.on('commandFailed', onFinished);
  return () => {
    client.off('commandStarted', onStarted);
    client.off('commandSucceeded', onFinished);
    client.off('commandFailed', onFinished);
    pending.clear();
  };
}
