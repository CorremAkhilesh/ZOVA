/** Helpers for inspecting MongoDB `explain()` output (classic and slot-based engines). */

type PlanNode = Record<string, unknown>;

function isNode(value: unknown): value is PlanNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every `stage` name in an explain document, depth-first, including nested and sharded plans. */
export function planStages(explain: unknown): string[] {
  const stages: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isNode(value)) return;
    if (typeof value.stage === 'string') stages.push(value.stage);
    for (const [key, child] of Object.entries(value)) {
      // Rejected plans are alternatives the planner did not pick; they don't run.
      if (key !== 'rejectedPlans') visit(child);
    }
  };
  visit(explain);
  return stages;
}

export type PlanVerdict = { ok: true } | { ok: false; reason: string };

/** A query is "indexed" when its winning plan never scans the whole collection. */
export function judgePlan(explain: unknown): PlanVerdict {
  const stages = planStages(explain);
  if (stages.length === 0) return { ok: false, reason: 'explain() returned no plan stages' };
  if (stages.includes('COLLSCAN')) {
    return { ok: false, reason: `query uses a collection scan (stages: ${stages.join(' > ')})` };
  }
  if (stages.includes('EOF') && !stages.includes('IXSCAN')) {
    return { ok: false, reason: 'collection does not exist yet, so the plan proves nothing' };
  }
  return { ok: true };
}
