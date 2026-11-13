import { EventEmitter } from 'node:events';
import type { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { judgePlan, planStages } from './query-plan.ts';
import { attachSlowQueryLogger, redactShape, summarizeCommand } from './slow-query.ts';

describe('planStages / judgePlan', () => {
  const ixscan = {
    queryPlanner: {
      winningPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'email_1' } },
      rejectedPlans: [{ stage: 'COLLSCAN' }],
    },
  };
  const collscan = { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } };
  const sbe = {
    queryPlanner: {
      winningPlan: { queryPlan: { stage: 'SORT', inputStage: { stage: 'COLLSCAN' } } },
    },
  };

  it('collects winning-plan stages and ignores rejected plans', () => {
    expect(planStages(ixscan)).toEqual(['FETCH', 'IXSCAN']);
  });

  it('accepts index scans', () => {
    expect(judgePlan(ixscan)).toEqual({ ok: true });
  });

  it.each([
    ['classic engine', collscan],
    ['slot-based engine (nested queryPlan)', sbe],
  ])('rejects a COLLSCAN in the %s', (_name, plan) => {
    expect(judgePlan(plan)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('COLLSCAN'),
    });
  });

  it('rejects an EOF plan for a missing collection', () => {
    expect(judgePlan({ queryPlanner: { winningPlan: { stage: 'EOF' } } })).toMatchObject({
      ok: false,
    });
  });

  it('rejects output without any stages', () => {
    expect(judgePlan({})).toMatchObject({ ok: false });
  });
});

describe('redactShape', () => {
  it('keeps keys and operators but hides every value', () => {
    const shape = redactShape({
      email: 'a@corremadvisory.com',
      createdAt: { $gte: new Date() },
      age: 3,
      tags: { $in: ['a', 'b', 'c', 'd', 'e'] },
      deleted: null,
    });
    expect(shape).toEqual({
      email: '?string',
      createdAt: { $gte: '?date' },
      age: '?number',
      tags: { $in: ['?string', '?string', '?string', '…+2'] },
      deleted: '?null',
    });
    expect(JSON.stringify(shape)).not.toContain('corremadvisory');
  });

  it('marks BSON values by type', () => {
    expect(redactShape({ _id: { _bsontype: 'ObjectId', id: 'x' } })).toEqual({ _id: '?objectid' });
  });

  it('stops at a maximum depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(JSON.stringify(redactShape(deep))).toContain('…');
  });
});

describe('summarizeCommand', () => {
  it('summarizes find with filter and sort', () => {
    const summary = summarizeCommand({
      commandName: 'find',
      command: { find: 'users', filter: { email: 'x@y.z' }, sort: { createdAt: -1 } },
    } as never);
    expect(summary).toEqual({
      collection: 'users',
      command: 'find',
      shape: { filter: { email: '?string' }, sort: { createdAt: '?number' } },
    });
  });

  it('uses the first update filter', () => {
    const summary = summarizeCommand({
      commandName: 'update',
      command: {
        update: 'chats',
        updates: [{ q: { _id: 'abc' }, u: { $set: { title: 'secret' } } }],
      },
    } as never);
    expect(summary?.shape).toEqual({ filter: { _id: '?string' } });
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('ignores non-query commands', () => {
    expect(summarizeCommand({ commandName: 'ping', command: { ping: 1 } } as never)).toBeNull();
    expect(summarizeCommand({ commandName: 'hello', command: { hello: 1 } } as never)).toBeNull();
  });
});

describe('attachSlowQueryLogger', () => {
  function setup(threshold: number) {
    const client = new EventEmitter();
    const logged: Array<{ object: Record<string, unknown>; message: string }> = [];
    const detach = attachSlowQueryLogger(
      client as unknown as Pick<MongoClient, 'on' | 'off'>,
      {
        warn: (object, message) =>
          logged.push({ object: object as Record<string, unknown>, message }),
      },
      threshold,
    );
    const run = (requestId: number, duration: number, outcome = 'commandSucceeded') => {
      client.emit('commandStarted', {
        requestId,
        commandName: 'find',
        command: { find: 'messages', filter: { chatId: 'c1', body: 'hello' } },
      });
      client.emit(outcome, { requestId, duration });
    };
    return { client, logged, detach, run };
  }

  it('logs queries at or over the threshold with shape only', () => {
    const { logged, run } = setup(100);
    run(1, 99);
    run(2, 150);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe('slow mongodb query');
    expect(logged[0]?.object).toMatchObject({
      collection: 'messages',
      command: 'find',
      durationMs: 150,
    });
    expect(JSON.stringify(logged[0]?.object)).not.toContain('hello');
  });

  it('also logs slow failed queries', () => {
    const { logged, run } = setup(10);
    run(3, 50, 'commandFailed');
    expect(logged).toHaveLength(1);
  });

  it('stops logging after detach', () => {
    const { logged, run, detach, client } = setup(0);
    detach();
    run(4, 500);
    expect(logged).toHaveLength(0);
    expect(client.listenerCount('commandStarted')).toBe(0);
  });
});
