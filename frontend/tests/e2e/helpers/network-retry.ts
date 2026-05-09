import type { Page } from "@playwright/test";

/**
 * Retry once on a narrowly-matched network/connection error.
 *
 * Two failure shapes appear in this suite:
 * - `CONNECTION_REFUSED` — browser-init timing window where the dev server
 *   isn't yet accepting on the first goto of the first test (firefox on
 *   `dashboard.spec.ts`).
 * - `CONNECTION_RESET` — dev server briefly drops an established connection
 *   under memory/GC pressure (Mobile Chrome on `docs-runner.spec.ts`).
 *
 * Both share the same papering-over shape: catch only the matched error,
 * wait a beat, retry once, otherwise rethrow. `matchError` keeps the swallow
 * narrow so any other failure surfaces immediately.
 */
export async function gotoWithRetry(
  page: Page,
  path: string,
  opts: { matchError: RegExp; waitMs?: number } = {
    matchError: /CONNECTION_(REFUSED|RESET)/i,
  },
): Promise<void> {
  const waitMs = opts.waitMs ?? 1000;
  try {
    await page.goto(path);
  } catch (e) {
    if (e instanceof Error && opts.matchError.test(e.message)) {
      await page.waitForTimeout(waitMs);
      await page.goto(path);
    } else {
      throw e;
    }
  }
}
