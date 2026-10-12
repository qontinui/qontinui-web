/**
 * Route-settle polling shared by the post-deploy page smokes
 * (verify-deploy-authed-smoke.ts, verify-operator-smoke.ts).
 *
 * A protected page renders its landmark only after client-side hydration plus
 * the authed API round-trips it gates on, so a single fixed-delay sample read a
 * merely slow prod render as a regression (and auto-rolled prod back): runs
 * 34675607499 / 36090455809 (/runs/active landmark missing) and 36915202471
 * (every route, with no deploy content change since the previous green run).
 * Polling to a deadline keeps a real regression a failure — a landmark that
 * never appears or a bounce still fails — while a slow one passes.
 */
import type { Page } from "@playwright/test";

/** How long a route gets to settle after `domcontentloaded`. */
export const ROUTE_SETTLE_TIMEOUT_MS = 15_000;
export const ROUTE_SETTLE_POLL_MS = 500;

export type RouteOutcome =
  | { kind: "ok" }
  | { kind: "bounce"; landedPath: string }
  | { kind: "missing" };

/** The slice of a Playwright Page that settling reads. */
type SettlePage = Pick<Page, "url">;

export interface SettleOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export function currentPath(page: SettlePage): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
}

/**
 * Poll until the route settles: a bounce to /login (the protected-route gate
 * rejected the seeded session) or its landmark visible (the page actually
 * rendered). Neither by the deadline is a missing landmark. A landmark probe
 * that throws counts as not-yet-visible.
 */
export async function settleRoute<P extends SettlePage>(
  page: P,
  landmark: (page: P) => Promise<boolean>,
  {
    timeoutMs = ROUTE_SETTLE_TIMEOUT_MS,
    pollMs = ROUTE_SETTLE_POLL_MS,
  }: SettleOptions = {}
): Promise<RouteOutcome> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const landedPath = currentPath(page);
    if (landedPath.startsWith("/login")) return { kind: "bounce", landedPath };
    if (await landmark(page).catch(() => false)) return { kind: "ok" };
    if (Date.now() >= deadline) return { kind: "missing" };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
