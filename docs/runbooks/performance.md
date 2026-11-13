# Performance runbook

How to measure the frontend's speed and memory, and what the numbers were at Step 19.

Everything runs against the **production build** (`vite preview`) and the E2E test API (in-memory
MongoDB, port 4197), never against Atlas, staging or a real Redis. The benchmarks are **not** part of
CI or the E2E suite: they are slow and their numbers depend on the machine.

## Commands

From `frontend/`:

```sh
pnpm build                       # always first: the benchmarks measure dist/
pnpm perf:chunks                 # bundle report: main bundle + largest chunks, gzip
pnpm perf                        # all benchmarks (starts its own API + preview, ports 4197/5194)
pnpm perf list-and-chat          # 500 chats + a 10,000-message chat
pnpm perf session                # memory and leaks over a long chatting session
pnpm perf lighthouse             # Lighthouse (mobile + desktop) + installability
```

- `pnpm perf` refuses to run if 4197 or 5194 is taken (it never talks to a server it did not start).
  Other ports: `E2E_API_PORT` / `E2E_WEB_PORT`. To reuse servers you started yourself (see
  `playwright.config.ts` for the two commands), set `PERF_EXTERNAL_SERVERS=1`.
- `PERF_LABEL=before` names the report files; `PERF_CYCLES` (default 8) sets the session length;
  `PERF_LH_RUNS` (default 3) sets the Lighthouse runs per page and preset.
- Reports (JSON, and Lighthouse HTML) go to `frontend/perf/reports/` (gitignored).
- The CI budget is unchanged: `pnpm --filter @zuvo/frontend size` fails above 200 KB gzip.

### What each benchmark does

| Benchmark       | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-and-chat` | Signs up, then writes 500 chats and one 10,000-message chat straight into the user's IndexedDB (`perf/seed.ts`). Times Settings → Chats until the first screen of rows is painted (5 runs after a warm-up; long tasks over 50 ms counted as "blocked"), scrolls the chat list to the end, times opening the big chat until its newest message shows (5 runs), and scrolls up through it at reading pace (240 px/frame, 8 s) and as a fling (2000 px/frame, to the start), timing every frame. |
| `session`       | Two people chat. Each cycle: 10 messages each way, Settings, Saved Messages, back, the photo viewer, a voice note played and closed. Two warm-up cycles, a forced GC (CDP), a snapshot, 8 cycles, GC, snapshot. Compares JS heap, DOM nodes, event listeners (CDP), open sockets, live object URLs, `<audio>` elements alive after GC, open AudioContexts, live `setInterval`s (with where each was started), and listeners on long-lived targets that were never removed (`perf/probes.ts`). |
| `lighthouse`    | Lighthouse 13 (CLI, Playwright's Chromium) on `/` (sign-in) and `/chats` signed in (session cookie as a header), mobile and desktop presets, 3 runs each, median kept. Then installability as Chromium sees it: `Page.getInstallabilityErrors` and the manifest, with the service worker controlling the page (Lighthouse 12+ has no PWA category).                                                                                                                                           |

## Numbers (Step 19)

Measured on the shared Windows dev server while other agents were building and testing on it:
**timings are noisy**. List and chat numbers are the median of 3 benchmark runs (each itself a median
of 5); Lighthouse is the median of 3 runs. "Before" is the build at the start of Step 19 (for
Lighthouse, the same build with source maps).

### Bundle (gzip)

|                                              | Before                                                     | After                                                                            |
| -------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Main bundle (`index-*.js`, CI budget 200 KB) | 160.1 KB                                                   | 124.5 KB                                                                         |
| Everything `index.html` loads up front       | 336.1 KB                                                   | 301.1 KB                                                                         |
| Largest lazy chunks                          | conversation 54.5, highlight 50.1, `_app` 26.5, chats 24.6 | highlight 50.1, conversation 45.4, `_app` 26.6, chats 25.0, motion features 17.0 |

### Chat list, big chat, scrolling

|                                         | Before             | After              |
| --------------------------------------- | ------------------ | ------------------ |
| 500-chat list, click → first rows shown | 222 ms             | 78 ms              |
| …of which main thread blocked (> 50 ms) | 171 ms             | 0 ms               |
| Chat rows in the page                   | 501                | 17                 |
| Chat list scroll                        | 60 fps             | 60 fps             |
| Open the 10,000-message chat            | 372 ms             | 129 ms             |
| Message list, reading pace              | 40 fps (p95 33 ms) | 40 fps (p95 36 ms) |
| Message list, fling to the start        | 32 fps (p95 50 ms) | 31 fps (p95 57 ms) |
| Message rows in the page, at most       | 35                 | 35                 |

### Long session (8 cycles: 160 messages sent and received)

|                                 | Before (start → end) | After (start → end) |
| ------------------------------- | -------------------- | ------------------- |
| JS heap after GC                | 15.9 → 18.1 MB       | 16.1 → 18.4 MB      |
| DOM nodes                       | 1083 → 1083          | 1091 → 1091         |
| Event listeners (all, CDP)      | 512 → 512            | 516 → 516           |
| `window` / `document` listeners | 41 / 17 → 41 / 17    | 41 / 17 → 41 / 17   |
| Live `setInterval`s             | 88 → 88              | 16 → 16             |
| Open sockets                    | 1 → 1                | 1 → 1               |
| Live object URLs                | 1 → 1                | 1 → 1               |
| `<audio>` alive / AudioContexts | 1 / 0 → 1 / 0        | 1 / 0 → 1 / 0       |

No leaks found: nothing grows per cycle except the heap (~0.3 MB per 20 messages: the messages
themselves, in the open chat's read window). The one `<audio>` element is the app's single shared
player; the one object URL is the photo's thumbnail on screen.

### Lighthouse (median of 3)

Scores: Performance / Accessibility / Best Practices (SEO was 91 throughout: no robots.txt).

| Page, preset     | Before         | After          | Main limit                                          |
| ---------------- | -------------- | -------------- | --------------------------------------------------- |
| Sign-in, mobile  | 95 / 100 / 96  | 98 / 100 / 96  | 401 from /v1/auth/me logged as a console error      |
| Sign-in, desktop | 99 / 100 / 96  | 98 / 100 / 96  | same                                                |
| /chats, mobile   | 61 / 100 / 100 | 62 / 100 / 100 | LCP ~7 s: cold device waits for chunks + first sync |
| /chats, desktop  | 78 / 100 / 100 | 93 / 100 / 100 | CLS 0.27 → 0 (panel layout fix)                     |

Installable: **yes**, before and after (`Page.getInstallabilityErrors` empty, manifest without
errors, service worker in control).

## What was fixed at Step 19

- **Chat list virtualized** (`ChatRows.tsx`, `@tanstack/react-virtual`, already a dependency): only
  the rows near the viewport are in the page; rows keep `aria-setsize`/`aria-posinset`. Rows are
  memoized and share one clock.
- **82 session poll timers in an open chat → 10.** Every `useSession()` is a TanStack Query observer
  with its own 5-minute `refetchInterval` timer, and each bubble had several. Bubbles, the local
  database hook and polls now use `useMyId()` (same cached session, no timer, re-renders only when the
  id changes); swipe-to-reply reads the session when it replies.
- **Motion loads after the first paint** (`LazyMotion` + `m.*`, features in
  `lib/motion-features.ts`): −30 KB gzip from the main bundle. Use `m.div`, not `motion.div`.
- **iOS install sheet** loads only when opened (its dialog code left the main bundle).
- **Desktop layout shift**: the resizable panels started at 50/50 before measuring and jumped to
  32/68 (CLS 0.27); they now start at their real layout.

## Known gaps (not fixed here)

- **Cold `/chats` on a slow phone** is slow in Lighthouse: the empty-device path waits for the
  session, then ~100 route chunks (most 1 KB: one per shared module or icon), then the first sync
  (`/v1/chats` → `/v1/sync` → `/v1/chats/self` → `/v1/sync`) before anything but a skeleton shows.
  `vite preview` serves HTTP/1.1 (6 connections), so the chunk count costs many round trips; Caddy
  in production serves HTTP/2/3, where it costs much less. A returning user (chats already in
  IndexedDB) does not wait for the sync. Merging chunks with Rolldown `codeSplitting.groups` was tried
  and rejected: it pulled lazy code into the first load (+55 KB).
- `GET /v1/auth/me` answers a signed-out visitor with 401, which the browser logs as a console error
  (Best Practices 96 on the sign-in page).
- Both locales (`en.json`, `hi.json`) are in the first load (~12 KB gzip for the unused one).
- Scrolling far back in a 10,000-message chat costs more per frame as more of it is loaded (the
  virtualizer re-measures all loaded rows); reading pace is unaffected.
