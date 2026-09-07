import type { Page } from "@playwright/test";

/**
 * Retry once on a narrowly-matched network/connection error.
 *
 * WHY THIS STILL EXISTS. Every CI lane that gates anything now runs against a
 * PRODUCTION build (`PLAYWRIGHT_WEB_SERVER=prod`, the default — see
 * `playwright.config.ts`), where none of the shapes below has been observed:
 * across the 525 navigations of the 4-shard gate run 34042283673, zero carried
 * an error and the slowest took 476 ms. The two remaining callers
 * (`pages/dashboard.spec.ts`, `pages/docs-runner.spec.ts`) keep it for the
 * NIGHTLY `cross-browser-survey` lane, the last one still pinned to `next dev`
 * — informational, `continue-on-error`, gating nothing. The suite-wide version
 * of this retry, which used to sit on the shared `page` fixture, was removed in
 * Phase 3 of plan
 * 2026-09-05-web-e2e-runs-against-next-dev-so-a-first-hit-compile-is-a-test-failure:
 * a blanket retry hides a genuine server fault from the lanes that DO gate.
 *
 * Three failure shapes were observed, all against `next dev`:
 * - `CONNECTION_REFUSED` — browser-init timing window where the dev server
 *   isn't yet accepting on the first goto of a test (firefox on
 *   `dashboard.spec.ts`; Mobile Chrome on `docs-runner.spec.ts:62`).
 * - `CONNECTION_RESET` — dev server briefly drops an established connection
 *   under memory/GC pressure (Mobile Chrome on `docs-runner.spec.ts`).
 * - `EMPTY_RESPONSE` — the same drop, seen from the other side: the dev
 *   server accepts and closes without a byte (chromium on
 *   `testing-global.spec.ts:178` in the 23-file changed-specs lane run on
 *   web#1265, 2026-09-05).
 *
 * All three share the same papering-over shape: catch only the matched error,
 * wait a beat, retry once, otherwise rethrow. The default `matchError`
 * covers all three — site-specific overrides exist for callers that
 * want to narrow further. The swallow stays narrow so any non-matching
 * failure (timeouts, 5xx, missing elements) surfaces immediately.
 */
export async function gotoWithRetry(
  page: Page,
  path: string,
  opts: { matchError?: RegExp; waitMs?: number } = {}
): Promise<void> {
  const matchError =
    opts.matchError ?? /CONNECTION_(REFUSED|RESET)|EMPTY_RESPONSE/i;
  const waitMs = opts.waitMs ?? 1000;
  try {
    await page.goto(path);
  } catch (e) {
    if (e instanceof Error && matchError.test(e.message)) {
      await page.waitForTimeout(waitMs);
      await page.goto(path);
    } else {
      throw e;
    }
  }
}
