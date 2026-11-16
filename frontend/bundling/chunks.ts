/**
 * How the production build is cut into files (Rolldown `output.codeSplitting`). Numbers in
 * docs/runbooks/performance.md.
 *
 * Automatic chunking makes one file for every set of routes that share a module, so the first
 * /chats screen loaded ~100 files, most of them 1 KB. On a phone every file costs a round trip.
 * The groups below bring that to ~14 without loading anything earlier than before:
 *
 * - `vendor`: the libraries of the first load (React, router, Query, i18next, Zod, Dexie…), in
 *   three files of ~100 KB gzip or less instead of a dozen small ones (`$initial` modules only).
 * - `boot`: the app's own first-load modules other than the entry (API client, i18n, stores).
 * - `first-screen`: the app shell (`_app`) and chat list (`_app/chats`) routes with the app code
 *   they import. Still lazy: the sign-in page does not load it. Modules of the first load are
 *   already taken by the groups above (`includeDependenciesRecursively: false` stops them being
 *   pulled back in, which would make this group part of the first load).
 * - `lib`: libraries of lazy screens (icons, hooks), grouped by the screens that use them.
 */
import type { Rolldown } from 'vite';

type CodeSplittingGroup = Rolldown.CodeSplittingGroup;

/** The routes of the first screen, as the router plugin's split modules (`…?tsr-split=…`). */
const FIRST_SCREEN_ROUTES = /[\\/]src[\\/]routes[\\/]_app(?:\.tsx|[\\/]chats(?:\.index)?\.tsx)\?/;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
const ENTRY = /[\\/]src[\\/]main\.tsx$/;

interface ModuleGraph {
  getModuleInfo(id: string): Rolldown.ModuleInfo | null;
}

/**
 * The app's own modules reachable from `roots` through static imports. Libraries are left out:
 * through a barrel file (`lucide-react`, the router's index) every icon or hook would look reachable.
 */
function appClosure(graph: ModuleGraph, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (seen.has(id) || NODE_MODULES.test(id)) continue;
    seen.add(id);
    for (const next of graph.getModuleInfo(id)?.importedIds ?? []) queue.push(next);
  }
  return seen;
}

/**
 * Everything the first-screen routes import statically. Runs after `vendor` and `boot`, which
 * have already taken the modules of the first load, so nothing here is needed before the app
 * starts. Rolldown calls `test` for every candidate first, then `name` (see its docs).
 */
function firstScreenGroup(): CodeSplittingGroup {
  const roots: string[] = [];
  const entries: string[] = [];
  let members: Set<string> | null = null;
  return {
    name: (id, ctx) => {
      if (!members) {
        const initial = appClosure(ctx, entries);
        members = new Set([...appClosure(ctx, roots)].filter((member) => !initial.has(member)));
      }
      return members.has(id) ? 'first-screen' : null;
    },
    test: (id) => {
      if (FIRST_SCREEN_ROUTES.test(id)) roots.push(id);
      if (ENTRY.test(id)) entries.push(id);
      return true;
    },
    includeDependenciesRecursively: false,
    priority: 1,
  };
}

function codeSplitting(): Rolldown.CodeSplittingOptions {
  return {
    groups: [
      // Libraries of the first load. Split near 1 MB of source (~110 KB gzip per file).
      { name: 'vendor', test: NODE_MODULES, tags: ['$initial'], maxSize: 1_000_000, priority: 3 },
      // The app's own first-load modules (not the entry), shared with lazy routes.
      {
        name: 'boot',
        test: (id) => !NODE_MODULES.test(id) && !ENTRY.test(id),
        tags: ['$initial'],
        priority: 2,
      },
      firstScreenGroup(),
      // Libraries of lazy screens (icons, hooks): one file per set of screens that use them, tiny
      // sets merged into a neighbour, instead of one file per icon.
      {
        name: 'lib',
        test: NODE_MODULES,
        entriesAware: true,
        entriesAwareMergeThreshold: 20_000,
      },
    ],
  };
}

export function buildOutput(): Rolldown.OutputOptions {
  return {
    codeSplitting: codeSplitting(),
    // Required with these groups: they move modules between files, and without it a module can
    // run before one it imports from another file (the app then fails to start). Costs ~30 KB gzip
    // of module wrappers, far less than the ~85 round trips it saves.
    strictExecutionOrder: true,
  };
}
