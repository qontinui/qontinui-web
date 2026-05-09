import type { Page } from "@playwright/test";

/**
 * Retry once on a narrowly-matched network/connection error.
 *
 * Two failure shapes appear in this suite under cross-browser-survey load:
 * - `CONNECTION_REFUSED` — browser-init timing window where the dev server
 *   isn't yet accepting on the first goto of a test (firefox on
 *   `dashboard.spec.ts`; Mobile Chrome on `docs-runner.spec.ts:62`).
 * - `CONNECTION_RESET` — dev server briefly drops an established connection
 *   under memory/GC pressure (Mobile Chrome on `docs-runner.spec.ts`).
 *
 * Both share the same papering-over shape: catch only the matched error,
 * wait a beat, retry once, otherwise rethrow. The default `matchError`
 * covers both classes — site-specific overrides exist for callers that
 * want to narrow further. The swallow stays narrow so any non-matching
 * failure (timeouts, 5xx, missing elements) surfaces immediately.
 */
export async function gotoWithRetry(
  page: Page,
  path: string,
  opts: { matchError?: RegExp; waitMs?: number } = {},
): Promise<void> {
  const matchError = opts.matchError ?? /CONNECTION_(REFUSED|RESET)/i;
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
