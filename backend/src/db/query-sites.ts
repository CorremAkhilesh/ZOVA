/**
 * Static scanner for Mongoose query call sites (`Model.find({...})`, `updateMany`, `aggregate`, …).
 * It reads TypeScript source as text: no compiler API, so it is a heuristic, and every site it
 * cannot resolve is reported for a human to check (see `scripts/index-coverage.ts`).
 */

import {
  blankComments,
  closeOf,
  enclosingName,
  lineAt,
  receiverBefore,
  splitTop,
} from './source-text.ts';

export { blankComments, closeOf, splitTop };

export const QUERY_METHODS = [
  'find',
  'findOne',
  'findById',
  'findByIdAndUpdate',
  'findByIdAndDelete',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
  'exists',
  'aggregate',
  'bulkWrite',
] as const;
export type QueryMethod = (typeof QUERY_METHODS)[number];

export interface QuerySite {
  file: string;
  line: number;
  /** Model property name (`ChatMember`), or null when the receiver could not be resolved. */
  model: string | null;
  method: QueryMethod;
  /** Filter fields, `$or.x` for fields inside `$or`/`$and`, `fn:name` for a filter built by `name()`. */
  fields: string[];
  /** The filter has parts the scanner cannot see (spread, variable, computed key). */
  dynamic: boolean;
  /** One filter per branch of a `cond ? {…} : {…}` filter. */
  variants?: Array<{ fields: string[]; dynamic: boolean }>;
  sort: string[];
  /** Name of the top-level declaration the call sits in. */
  within: string | null;
}

const MODELS = [
  'AuditLog',
  'AuthAccount',
  'AuthSession',
  'AuthUser',
  'AuthVerification',
  'Block',
  'Chat',
  'ChatMember',
  'Folder',
  'LinkPreview',
  'LinkPreviewImage',
  'Lock',
  'LockCredential',
  'Media',
  'Message',
  'MessageHidden',
  'PushSubscription',
  'ReceiptEvent',
  'Report',
  'Scheduled',
  'SecurityToken',
  'Star',
  'UserSync',
  'UserUpdate',
  'WallpaperImage',
];

/** Accessors and local names that stand for a model. */
const ALIASES: Array<[RegExp, string]> = [
  [/\b(usersModel|users)\(.*\)$/, 'AuthUser'],
  [/\b(Users|users|User)$/, 'AuthUser'],
  [/\bfolders\(.*\)$/, 'Folder'],
  [/\btokens\(.*\)$/, 'SecurityToken'],
  [/\bAudit$/, 'AuditLog'],
  [/\b(Sessions|sessions)$|\bsessionsModel\(\)$/, 'AuthSession'],
  [/\bsubscriptions\(.*\)$/, 'PushSubscription'],
];

export interface Shape {
  fields: string[];
  dynamic: boolean;
  /** `cond ? {…} : {…}`: each branch is a query of its own and needs its own index. */
  variants?: Shape[];
}

const unquote = (key: string) => key.replace(/^['"`]|['"`]$/g, '');

/** The value a local name was given (`const name = …`), or null when it cannot be followed. */
type Lookup = (name: string) => string | null;

/**
 * `_id` only promises an index lookup with equality or `$in`. `{ $nin }`, `{ $gt }` and the like
 * are listed as `_id:range`, which is not counted as covered by the `_id` index.
 */
function idKey(raw: string | undefined, lookup: Lookup): string {
  const value = raw && /^[\w$]+$/.test(raw) ? (lookup(raw) ?? raw) : raw;
  const operators = value?.trim().startsWith('{') ? (value.match(/\$\w+/g) ?? []) : [];
  const exact = operators.length === 0 || operators.some((op) => op === '$eq' || op === '$in');
  return exact ? '_id' : '_id:range';
}

/** Top-level keys of an object literal (`{ a, 'b.c': 1, $or: [...] }`). */
export function objectShape(literal: string, lookup: Lookup = () => null): Shape {
  const body = literal.trim().replace(/^\(|\)$/g, '');
  if (!body.startsWith('{')) return { fields: [], dynamic: true };
  const fields = new Set<string>();
  let dynamic = false;
  for (const part of splitTop(body.slice(1, closeOf(body, 0) - 1))) {
    const spread = /^\.\.\.([\w$]+)$/.exec(part)?.[1];
    const given = spread ? lookup(spread) : null;
    const followed = given?.startsWith('{') ? objectShape(given, lookup) : null;
    if (followed) {
      dynamic ||= followed.dynamic;
      for (const field of followed.fields) fields.add(field);
      continue;
    }
    if (part.startsWith('...') || part.startsWith('[')) {
      dynamic = true;
      continue;
    }
    const [rawKey, value] = splitTop(part, ':');
    const key = unquote(rawKey ?? '');
    if ((key === '$or' || key === '$and' || key === '$nor') && value?.startsWith('[')) {
      for (const branch of splitTop(value.slice(1, closeOf(value, 0) - 1))) {
        const inner = objectShape(branch, lookup);
        dynamic ||= inner.dynamic;
        for (const field of inner.fields) fields.add(`$or.${field}`);
      }
    } else {
      fields.add(key === '_id' ? idKey(value, lookup) : key);
    }
  }
  return { fields: [...fields].sort(), dynamic };
}

export function modelOf(receiver: string): string | null {
  // `Model.collection.updateOne(…)`: the driver, same collection.
  const plain = receiver.replace(/\?$/, '').replace(/\.collection$/, '');
  const named = /(?:^|\.)([A-Z]\w*)$/.exec(plain)?.[1];
  if (named && MODELS.includes(named)) return named;
  for (const [pattern, model] of ALIASES) if (pattern.test(plain)) return model;
  return null;
}

const ARROW = /^(async\s*)?(\([^)]*\)|[\w$]+)\s*=>|^function\b/;

/** `const name = …` before `before`: its right-hand side, or null. */
function definitionOf(
  text: string,
  name: string,
  before: number,
): { value: string; end: number } | null {
  const pattern = new RegExp(`\\b(?:const|let)\\s+${name}\\b[^=;]*=\\s*`, 'g');
  let found: { value: string; end: number } | null = null;
  for (const match of text.slice(0, before).matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    let rest = text.slice(start);
    // `const name = (args) => ({ … })`: the object the arrow returns.
    const arrow = /^(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*/.exec(rest);
    if (arrow) rest = rest.slice(arrow[0].length);
    const end = rest.startsWith('{') || rest.startsWith('(') ? closeOf(rest, 0) : rest.indexOf(';');
    const value = rest.slice(0, end < 0 ? undefined : end);
    found = { value, end: start + (arrow?.[0].length ?? 0) + value.length };
  }
  return found;
}

/** `name.key = …` assignments between `from` and `to`: optional fields, shown as `?key`. */
function assignedKeys(text: string, name: string, from: number, to: number): string[] {
  const pattern = new RegExp(`\\b${name}\\.([\\w$]+)\\s*=(?!=)`, 'g');
  return [...text.slice(from, to).matchAll(pattern)].map((match) => `?${match[1]}`);
}

/** The filter's shape, following a variable or a filter-building call when it can. */
export function filterShape(text: string, argument: string | undefined, at: number): Shape {
  const arg = (argument ?? '').replace(/\s+as\s+[\w<>[\]., ]+$/, '').trim();
  if (arg === '') return { fields: [], dynamic: false };
  const resolve: Lookup = (name) => definitionOf(text, name, at)?.value ?? null;
  if (arg.startsWith('{') || arg.startsWith('({')) return objectShape(arg, resolve);
  // `cond ? { a, b } : { a }`: fields in both are always there, the others optional.
  const ternary = /^[\w$.!]+\s*\?\s*(?=[{(])/.exec(arg);
  const branches = ternary ? splitTop(arg.slice(ternary[0].length), ':') : [];
  if (branches.length === 2) {
    const [yes, no] = branches.map((branch) => filterShape(text, branch, at)) as [Shape, Shape];
    const both = yes.fields.filter((field) => no.fields.includes(field));
    const either = [...yes.fields, ...no.fields].filter((field) => !both.includes(field));
    const optional = [...new Set(either)].map((field) => field.replace(/^\??/, '?'));
    return {
      fields: [...both, ...optional].sort(),
      dynamic: yes.dynamic || no.dynamic,
      variants: [yes, no],
    };
  }
  const call = /^(?:await\s+)?([\w$]+)\s*\(/.exec(arg);
  if (call?.[1]) {
    const built = definitionOf(text, call[1], at);
    if (built && /^\(?\{/.test(built.value)) return objectShape(built.value, resolve);
    return { fields: [`fn:${call[1]}`], dynamic: false };
  }
  if (/^[\w$]+$/.test(arg)) {
    const definition = definitionOf(text, arg, at);
    if (definition && !definition.value.startsWith(arg)) {
      const shape = filterShape(text, definition.value, definition.end);
      const optional = assignedKeys(text, arg, definition.end, at);
      if (optional.length === 0) return shape;
      return { fields: [...shape.fields, ...optional].sort(), dynamic: true };
    }
  }
  return { fields: [], dynamic: true };
}

function sortAfter(text: string, end: number): string[] {
  let i = end;
  for (;;) {
    const next = /^\s*\.\s*([\w$]+)\s*\(/.exec(text.slice(i, i + 200));
    if (!next) return [];
    const open = i + next[0].length - 1;
    const close = closeOf(text, open);
    if (next[1] === 'sort') return objectShape(text.slice(open + 1, close - 1)).fields;
    i = close;
  }
}

/** Filter shape of one call, by method. */
function shapeFor(text: string, method: QueryMethod, args: string[], at: number): Shape {
  if (method.startsWith('findById')) return { fields: ['_id'], dynamic: false };
  if (method === 'distinct') return filterShape(text, args[1], at);
  if (method === 'aggregate') {
    const pipeline = args[0] ?? '';
    const match = /\$match\s*:\s*/.exec(pipeline);
    if (!match) return { fields: [], dynamic: true };
    const start = (match.index ?? 0) + match[0].length;
    return filterShape(text, pipeline.slice(start, closeOf(pipeline, start)), at);
  }
  if (method === 'bulkWrite') {
    const filter = /filter\s*:\s*/.exec(args[0] ?? '');
    if (!filter) return { fields: [], dynamic: true };
    const rest = (args[0] ?? '').slice((filter.index ?? 0) + filter[0].length);
    return filterShape(text, rest.slice(0, closeOf(rest, 0)), at);
  }
  return filterShape(text, args[0], at);
}

/** Every query call site in one file's source. Array `.find(x => …)` calls are skipped. */
export function scanQueries(file: string, source: string): QuerySite[] {
  const text = blankComments(source);
  const sites: QuerySite[] = [];
  const pattern = new RegExp(`\\.\\s*(${QUERY_METHODS.join('|')})\\s*\\(`, 'g');
  for (const match of text.matchAll(pattern)) {
    const dot = match.index ?? 0;
    const method = match[1] as QueryMethod;
    const open = dot + match[0].length - 1;
    const close = closeOf(text, open);
    const args = splitTop(text.slice(open + 1, close - 1));
    if (ARROW.test(args[0] ?? '')) continue;
    const receiver = receiverBefore(text, dot);
    const model = modelOf(receiver);
    // `storage.exists(key)`, `map.find`, … : not a model, and not a query.
    if (!model && !/^[A-Z]|Model|models|\)$/.test(receiver.split('.').at(-1) ?? '')) continue;
    const shape = shapeFor(text, method, args, dot);
    sites.push({
      file,
      line: lineAt(text, dot),
      model,
      method,
      fields: shape.fields,
      dynamic: shape.dynamic,
      ...(shape.variants ? { variants: shape.variants } : {}),
      sort: sortAfter(text, close),
      within: enclosingName(text, dot),
    });
  }
  return sites;
}
