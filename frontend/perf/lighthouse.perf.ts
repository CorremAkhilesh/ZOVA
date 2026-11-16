import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, expect, test } from '@playwright/test';
import { signUp } from '../e2e/helpers';
import { median } from './probes';

/**
 * Lighthouse on the built app: the sign-in page, and /chats signed in (the session cookie is passed
 * as a header). Mobile and desktop presets, each run PERF_LH_RUNS times (median kept, all saved).
 * Installability is checked in Chromium itself (Lighthouse 12+ has no PWA category).
 */
const RUNS = Number(process.env.PERF_LH_RUNS ?? 3);
const LABEL = process.env.PERF_LABEL ?? 'latest';
const OUT = 'perf/reports';
/** Chats the signed-in user has on the server (groups with a couple of messages each): a phone screen of rows. */
const SEEDED_CHATS = 8; // the API allows 10 new groups an hour
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
type Scores = Record<(typeof CATEGORIES)[number], number>;

const cli = createRequire(import.meta.url).resolve('lighthouse/cli/index.js');

function lighthouse(
  url: string,
  preset: 'mobile' | 'desktop',
  cookie: string | null,
  file: string,
) {
  const headers = cookie ? [`--extra-headers=${JSON.stringify({ Cookie: cookie })}`] : [];
  execFileSync(
    process.execPath,
    [
      cli,
      url,
      `--chrome-path=${chromium.executablePath()}`,
      '--chrome-flags=--headless=new --no-first-run',
      ...(preset === 'desktop' ? ['--preset=desktop'] : []),
      `--only-categories=${CATEGORIES.join(',')}`,
      ...headers,
      '--output=json',
      '--output=html',
      `--output-path=${file}`,
      '--quiet',
    ],
    { stdio: 'inherit', timeout: 300_000 },
  );
  const report = JSON.parse(readFileSync(`${file}.report.json`, 'utf8')) as {
    categories: Record<string, { score: number | null }>;
    audits: Record<string, { score: number | null; title: string; numericValue?: number }>;
  };
  const scores = Object.fromEntries(
    CATEGORIES.map((key) => [key, Math.round((report.categories[key]?.score ?? 0) * 100)]),
  ) as Scores;
  const failing = Object.entries(report.audits)
    .filter(([, audit]) => audit.score !== null && audit.score < 0.9)
    .map(([id]) => id);
  const metrics = Object.fromEntries(
    [
      'first-contentful-paint',
      'largest-contentful-paint',
      'total-blocking-time',
      'cumulative-layout-shift',
      'speed-index',
    ].map((id) => [id, Math.round((report.audits[id]?.numericValue ?? 0) * 1000) / 1000]),
  );
  return { scores, metrics, failing };
}

test('Lighthouse and installability', async ({ browser, baseURL }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = await signUp(page, 'Lighthouse');
  // A realistic first screen: the chat list has rows (its LCP is a row, not the empty state).
  for (let n = 1; n <= SEEDED_CHATS; n++) {
    const created = await page.request.post('/v1/groups', {
      data: { name: `Team ${n}`, memberIds: [] },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { chat } = (await created.json()) as { chat: { id: string } };
    const seeded = await page.request.post('/v1/test/seed-messages', {
      data: { chatId: chat.id, email, count: 2 },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
  }
  const cookie = (await context.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ');

  // Installable: manifest, icons and a service worker controlling the page, as Chromium sees it.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  const manifest = await cdp.send('Page.getAppManifest');
  const installability = {
    installable: installabilityErrors.length === 0,
    errors: installabilityErrors.map((error) => error.errorId),
    manifestUrl: manifest.url,
    manifestErrors: manifest.errors.map((error) => error.message),
  };
  await context.close();

  const results: Record<string, unknown> = {};
  for (const [name, path, signedIn] of [
    ['sign-in', '/', false],
    ['chats', '/chats', true],
  ] as const) {
    for (const preset of ['mobile', 'desktop'] as const) {
      const runs: ReturnType<typeof lighthouse>[] = [];
      for (let run = 1; run <= RUNS; run++) {
        const file = `${OUT}/lighthouse-${LABEL}-${name}-${preset}-${run}`;
        const measure = () =>
          lighthouse(`${baseURL}${path}`, preset, signedIn ? cookie : null, file);
        // A loaded machine sometimes makes Chrome miss the paint (NO_FCP): one more try.
        let result: ReturnType<typeof lighthouse>;
        try {
          result = measure();
        } catch {
          result = measure();
        }
        runs.push(result);
      }
      const scores = Object.fromEntries(
        CATEGORIES.map((key) => [key, median(runs.map((run) => run.scores[key]))]),
      );
      results[`${name}/${preset}`] = {
        median: scores,
        runs: runs.map((run) => run.scores),
        metrics: runs.map((run) => run.metrics),
        failingAudits: [...new Set(runs.flatMap((run) => run.failing))],
      };
    }
  }
  const numbers = { label: LABEL, at: new Date().toISOString(), installability, results };
  // biome-ignore lint/suspicious/noConsole: these numbers are what this benchmark is for
  console.log(`LIGHTHOUSE ${JSON.stringify(numbers, null, 2)}`);
  writeFileSync(`${OUT}/lighthouse-${LABEL}.json`, JSON.stringify(numbers, null, 2));
  expect(installability.errors).toEqual([]);
});
