import type { Model } from 'mongoose';
import { judgePlan } from '../src/db/query-plan.ts';

/** Anything with Mongoose's `explain()`: a Query or an Aggregate, plus the model it runs on. */
interface Explainable {
  model: Pick<Model<unknown>, 'init'>;
  explain(verbosity?: string): Promise<unknown>;
}

/**
 * Fails the test if the query's winning plan contains a COLLSCAN.
 * Builds the model's collection and indexes first, so the planner sees the real indexes.
 *
 *   await expectIndexedQuery(Chat.find({ members: userId }).sort({ lastMessageAt: -1 }));
 */
export async function expectIndexedQuery(query: Explainable): Promise<void> {
  await query.model.init();
  const verdict = judgePlan(await query.explain('queryPlanner'));
  if (!verdict.ok) {
    throw new Error(`expectIndexedQuery: ${verdict.reason}`);
  }
}
