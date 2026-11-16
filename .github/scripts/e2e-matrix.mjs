// Prints the E2E shard matrix for GitHub Actions as `matrix=<json>` (append it to $GITHUB_OUTPUT).
//   argument `full` → pull request into main / manual run: every browser, and the dev-proxy run.
//   no argument     → push to dev: Chromium only.
// Shard counts keep each job near 5 minutes of tests (docs/runbooks/ci.md).
//   node .github/scripts/e2e-matrix.mjs [full]

const MAIN = 'playwright.config.ts';
const DEV = 'playwright.dev.config.ts';

/** name: job label · project: Playwright project · browser: what `playwright install` needs. */
const SUITES = [
  { name: 'chromium', project: 'chromium', browser: 'chromium', config: MAIN, shards: 3 },
  { name: 'firefox', project: 'firefox', browser: 'firefox', config: MAIN, shards: 3, full: true },
  { name: 'webkit', project: 'webkit', browser: 'webkit', config: MAIN, shards: 3, full: true },
  { name: 'mobile', project: 'mobile', browser: 'chromium', config: MAIN, shards: 2, full: true },
  {
    name: 'dev-proxy',
    project: 'dev-chromium',
    browser: 'chromium',
    config: DEV,
    shards: 3,
    full: true,
  },
];

const full = process.argv[2] === 'full';
const include = SUITES.filter((suite) => full || !suite.full).flatMap(({ shards, ...suite }) =>
  Array.from({ length: shards }, (_, index) => ({
    name: suite.name,
    project: suite.project,
    browser: suite.browser,
    config: suite.config,
    shard: index + 1,
    total: shards,
  })),
);

process.stdout.write(`matrix=${JSON.stringify({ include })}\n`);
