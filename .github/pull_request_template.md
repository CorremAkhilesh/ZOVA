## What

<!-- One or two sentences: what this PR changes and why. -->

## How to test

<!-- Steps a reviewer can follow locally or on staging. -->

## Checklist

- [ ] Conventional Commit messages
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] Tests added or updated (CLAUDE.md §7); bug fixes include a test that failed before the fix
- [ ] New queries are indexed and covered by `expectIndexedQuery()` (CLAUDE.md §8)
- [ ] No secrets committed; `.env.example` updated if env changed
- [ ] UI changes checked in light + dark, desktop + mobile, and with a keyboard
- [ ] Screenshots attached for visual changes
