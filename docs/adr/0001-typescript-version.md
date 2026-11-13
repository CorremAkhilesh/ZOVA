# ADR 0001: TypeScript version

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

CLAUDE.md requires the latest stable package versions. The latest stable TypeScript is **7.0.x**, the
native (Go) compiler. It is much faster than 5.x/6.x, but it ships only the `tsc` binary (with an
`--lsp` mode). It does **not** include the classic JavaScript compiler API (`typescript.js`,
`tsserver.js`). Tools that `import 'typescript'` to use that API will not work with it.

TypeScript 6.0 is the bridge release: it type-checks the same way as 7.0 and still has the classic API.

We agreed to keep TS 7 only if typecheck, Vitest, editor support and the shared-package `exports` all
work. Otherwise we would fall back to 6.x/5.x.

## Verification (Step 2)

| Check                                                                                               | Result           |
| --------------------------------------------------------------------------------------------------- | ---------------- |
| `pnpm typecheck`, all 5 packages, on TS 7.0.2                                                       | Pass             |
| Cross-package type errors are reported (a deliberate error in the backend against `@zuvo/protocol`) | Pass             |
| `pnpm test`: Vitest 5 runs TS source through Vite/esbuild and does not need the TS API              | Pass (110 tests) |
| Internal packages resolved through `package.json` `exports` that point at `.ts` source              | Pass             |
| `extends: "@zuvo/config/tsconfig.base.json"` resolved through package `exports`                     | Pass             |
| Same projects type-checked with TypeScript **6.0.3**, the version bundled in VS Code 1.143          | Pass             |
| `node scripts/generate-css.ts` (Node 24 native type stripping)                                      | Pass             |

## Decision

**Keep TypeScript 7.0.x** as the project compiler: `tsc --noEmit` in every package.

- **Editor:** VS Code uses its bundled TypeScript 6.0 language service by default, which type-checks the
  same way. Developers can opt in to the native TS 7 language service with the VS Code setting
  `"js/ts.experimental.useTsgo": true`.
- **Config:** the shared `tsconfig.base.json` uses only options that both 6.0 and 7.0 support,
  including `erasableSyntaxOnly`. That keeps code runnable by Node's type stripping and rules out
  `enum`/`namespace`.

## Consequences

- Any future tool that needs the classic compiler API must be checked before it is adopted. Examples
  are `typescript-eslint`, `vite-plugin-dts`, `ts-morph`-based generators and the Vitest `typecheck`
  mode with the `tsc` checker.
- If such a tool is required, add `typescript@6` **only to that package** as an alias, for example
  `"typescript-api": "npm:typescript@6"`, or revisit this ADR. Do not downgrade the whole repo silently.
- CI runs the same `pnpm typecheck` on TS 7.
