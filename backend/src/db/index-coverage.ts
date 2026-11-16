/**
 * Which query call sites an `expectIndexedQuery()` test covers (CLAUDE.md §8), matched by model and
 * filter shape. Rendered to docs/runbooks/index-coverage.md by `pnpm --filter @zuvo/backend
 * index:coverage`.
 */
import { closeOf, type QuerySite, scanQueries } from './query-sites.ts';

export interface IndexTest {
  file: string;
  line: number;
  model: string | null;
  fields: string[];
  sort: string[];
}

export type Status =
  | { kind: 'covered'; by: string }
  | { kind: 'id'; by: string }
  | { kind: 'gap'; by: string }
  | { kind: 'review'; by: string };

export interface Classified extends QuerySite {
  status: Status;
}

/** Explained by hand: sites the scanner cannot judge. Key: `file:method:within`. */
export type Notes = Record<string, string>;

/** Every `expectIndexedQuery(...)` in a test file: the queries inside it, and helper names used. */
export function scanIndexTests(
  file: string,
  text: string,
): { tests: IndexTest[]; helpers: string[] } {
  const ranges: Array<[number, number]> = [];
  const helpers: string[] = [];
  let line = 1;
  let last = 0;
  for (const match of text.matchAll(/expectIndexedQuery\(/g)) {
    const at = match.index ?? 0;
    for (let i = last; i < at; i++) if (text.charCodeAt(i) === 10) line++;
    last = at;
    const open = at + match[0].length - 1;
    const raw = text.slice(open + 1, closeOf(text, open) - 1);
    const arg = raw.trim();
    const end = line + (raw.match(/\n/g)?.length ?? 0);
    ranges.push([line, end]);
    const helper = /^(?:await\s+)?([a-z][\w$]*)\(/.exec(arg)?.[1];
    if (helper) helpers.push(helper);
    // A call like `Message.find(storageFilter(...))`: that helper builds a tested filter.
    for (const inner of arg.matchAll(/\(\s*([a-z][\w$]*)\(/g)) if (inner[1]) helpers.push(inner[1]);
  }
  const tests = scanQueries(file, text)
    .filter((site) => ranges.some(([from, to]) => site.line >= from && site.line <= to))
    .map(({ model, fields, sort, line: at }) => ({
      file,
      line: at,
      model,
      fields: required(fields),
      sort,
    }));
  return { tests, helpers };
}

const subset = (small: string[], big: string[]) => small.every((field) => big.includes(field));
/** Fields every run of the query has (`?x` = only sometimes). */
const required = (fields: string[]) => fields.filter((field) => !field.startsWith('?'));
const where = (test: IndexTest) => `${test.file}:${test.line}`;

/** Equality or `$in` on `_id`, or only an `_id` range sorted by `_id`: the `_id` index serves it. */
function usesId(site: QuerySite): boolean {
  const always = required(site.fields);
  if (always.includes('_id')) return true;
  const rangeOnly = always.every((field) => field === '_id:range');
  return rangeOnly && site.sort[0] === '_id';
}

function classifyShape(site: QuerySite, tests: IndexTest[]): Status {
  if (usesId(site)) return { kind: 'id', by: '`_id` index' };
  if (!site.model) return { kind: 'review', by: 'model not resolved' };
  const same = tests.filter((test) => test.model === site.model);
  const always = required(site.fields);
  // Extra predicates never take an index away: a test of a subset of the fields covers this one.
  const match =
    same.find((test) => test.fields.length > 0 && subset(test.fields, always)) ??
    same.find(
      (test) =>
        test.fields.length === 0 &&
        always.length === 0 &&
        site.sort.length > 0 &&
        subset(site.sort, test.sort),
    );
  if (match) return { kind: 'covered', by: where(match) };
  if (site.dynamic && always.length === 0) return { kind: 'review', by: 'filter not visible' };
  return { kind: 'gap', by: 'no test with this shape' };
}

/** The automatic verdict; a hand-written note replaces it only where that verdict is not "covered". */
export function classify(
  site: QuerySite,
  tests: IndexTest[],
  helpers: Set<string>,
  notes: Notes,
): Status {
  const status = autoClassify(site, tests, helpers);
  const note = notes[`${site.file}:${site.method}:${site.within ?? ''}`];
  if (!note || status.kind === 'covered' || status.kind === 'id') return status;
  return { kind: note.startsWith('gap') ? 'gap' : 'review', by: note };
}

function autoClassify(site: QuerySite, tests: IndexTest[], helpers: Set<string>): Status {
  if (site.within && helpers.has(site.within)) {
    return { kind: 'covered', by: `helper \`${site.within}()\` tested` };
  }
  const builtBy = site.fields.find((field) => field.startsWith('fn:'))?.slice(3);
  if (builtBy && helpers.has(builtBy)) {
    return { kind: 'covered', by: `filter from \`${builtBy}()\` tested` };
  }
  if (!site.variants) return classifyShape(site, tests);
  // Each branch of a `cond ? {…} : {…}` filter is its own query.
  const each = site.variants.map((variant) => classifyShape({ ...site, ...variant }, tests));
  const worst = (['gap', 'review'] as const).find((kind) => each.some((s) => s.kind === kind));
  const by = each.map((status) => status.by).join(' + ');
  if (worst) return { kind: worst, by };
  return { kind: each.every((status) => status.kind === 'id') ? 'id' : 'covered', by };
}

export interface Report {
  sites: Classified[];
  counts: Record<Status['kind'], number> & { total: number };
}

export function buildReport(
  sources: Array<{ file: string; text: string }>,
  testSources: Array<{ file: string; text: string }>,
  notes: Notes = {},
): Report {
  const tests: IndexTest[] = [];
  const helpers = new Set<string>();
  for (const { file, text } of testSources) {
    const found = scanIndexTests(file, text);
    tests.push(...found.tests);
    for (const helper of found.helpers) helpers.add(helper);
  }
  const sites = sources
    .flatMap(({ file, text }) => scanQueries(file, text))
    .map((site) => ({ ...site, status: classify(site, tests, helpers, notes) }));
  const counts = { total: sites.length, covered: 0, id: 0, gap: 0, review: 0 };
  for (const site of sites) counts[site.status.kind]++;
  return { sites, counts };
}

const LABEL: Record<Status['kind'], string> = {
  covered: 'covered',
  id: 'covered (`_id`)',
  gap: '**GAP**',
  review: 'reviewed',
};

const cell = (text: string) => text.replaceAll('|', '\\|');

export function renderReport(report: Report): string {
  const { counts } = report;
  const lines = [
    '| Status | Sites |',
    '| --- | --- |',
    `| covered by an \`expectIndexedQuery()\` test of the same model + filter shape | ${counts.covered} |`,
    `| covered by the \`_id\` index (filter on \`_id\`) | ${counts.id} |`,
    `| reviewed by hand (see the note) | ${counts.review} |`,
    `| **gap** (no test) | ${counts.gap} |`,
    `| **total** | ${counts.total} |`,
    '',
  ];
  const byFile = Map.groupBy(report.sites, (site) => site.file);
  for (const [file, sites] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### \`${file}\``, '', '| Line | Model | Method | Filter | Sort | Status | By |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const site of sites) {
      const filter =
        site.fields.join(', ') + (site.dynamic ? (site.fields.length ? ', …' : '…') : '');
      lines.push(
        `| ${site.line} | ${site.model ?? '?'} | ${site.method} | ${cell(filter || '{}')} | ${cell(
          site.sort.join(', '),
        )} | ${LABEL[site.status.kind]} | ${cell(site.status.by)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
