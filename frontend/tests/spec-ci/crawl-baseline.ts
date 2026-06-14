/**
 * Crawl baseline / waiver registry for Spec CI's spec-less route crawl (C8).
 *
 * The crawl (`run-spec-ci.ts`, the Phase-4 lane) visits every navigable app
 * route that has NO IR spec and applies the SAME run-level invariants the
 * spec'd pages get: critical browser console errors (`console-policy.ts`),
 * same-origin HTTP-5xx (`server-error-policy.ts`), and basic page-health
 * (`navigatedOk`). When the crawl is GATING, a NEW finding on any crawled
 * route reds the on-PR gate, attributed to that route.
 *
 * Spec'd pages waive a pre-existing finding via the spec's own
 * `metadata.expectedConsoleErrors` / `metadata.expectedServerErrors`. Crawled
 * routes have no spec file, so this module is their equivalent: a
 * SOURCE-CONTROLLED, narrowly-scoped waiver registry that lets the established
 * baseline land green while still enforcing zero NEW findings.
 *
 * Two kinds of waiver, deliberately separated:
 *
 *   1. PER-ROUTE waivers (`PER_ROUTE_WAIVERS`) — keyed by the exact crawl route
 *      path (e.g. "/admin/coord/devices"). Each waiver lists the SPECIFIC
 *      console-text patterns and/or same-origin-5xx URL patterns that are
 *      expected on THAT route, plus `allowNavFail` for the rare route whose
 *      navigation legitimately fails in CI. A mandatory `note` documents WHY
 *      (matching the honesty of the spec `expectedServerErrorsNote` waivers:
 *      CI-ENV-UNAVOIDABLE vs REAL-BUG-tracked vs the precise cause).
 *
 *   2. GLOBAL URL-pattern waivers (`GLOBAL_SERVER_WAIVERS`) — same-origin-5xx
 *      URL patterns that are CI-environment-unavoidable on ANY route because
 *      the backing service is structurally unreachable from a GitHub Actions
 *      runner (no coord process; private-subnet RDS). These mirror the two
 *      already-known classes the spec waivers documented (`/coord-api/*`,
 *      `/api/vga/*`). A page-route waiver is preferred when the finding is
 *      route-specific; a global waiver is only for a backend class that no
 *      single route "owns".
 *
 * Design rules (enforced by review, not code):
 *   - NEVER a blanket "ignore all crawl findings". Every waiver is a specific
 *     route + specific pattern (or a specific backend URL class).
 *   - Patterns are matched as substrings-or-regex via the SAME compile shape as
 *     `compileExpectedConsoleErrors` (invalid regex falls back to a literal
 *     match), so a plain substring always works.
 *   - The console denylists (`console-policy.ts`) handle BENIGN NOISE classes
 *     (favicon/hydration/3p/abort). A genuinely benign NEW class is fixed there,
 *     NOT here — a per-route waiver is for a real-but-expected finding on a
 *     known route, never to hide a broad noise class.
 */

import type { ConsoleErrorEntry } from "./console-policy";
import type { ServerErrorEntry } from "./server-error-policy";

/** Compile a list of substring-or-regex strings into matchers. Mirrors
 *  `compileExpectedConsoleErrors` exactly (invalid regex → literal-escaped). */
function compilePatterns(raw: readonly string[]): RegExp[] {
  return raw.map((s) => {
    try {
      return new RegExp(s);
    } catch {
      return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  });
}

/**
 * Classification tag for a waiver, surfaced in the report so the follow-up
 * triage has a machine-readable worklist. Mirrors the directive's taxonomy.
 *   - "ci-env"   : structurally unavoidable in CI (no coord / private RDS).
 *   - "real-bug" : a genuine same-origin 500 / console error to FIX (tech-debt;
 *                  NOT fixed in the gating PR — waived with a flagged note).
 *   - "benign"   : an expected-but-harmless finding specific to this route that
 *                  doesn't fit a global denylist class.
 */
export type WaiverClass = "ci-env" | "real-bug" | "benign";

export interface PerRouteWaiver {
  /** Console-text patterns expected on this route (substring or regex). */
  consolePatterns?: readonly string[];
  /** Same-origin-5xx URL patterns expected on this route (substring or regex). */
  serverPatterns?: readonly string[];
  /** Allow this route's navigation to fail (goto throw) without gating. Rare —
   *  only for a route that legitimately cannot load in the CI environment. */
  allowNavFail?: boolean;
  /** Classification for the report worklist. */
  class: WaiverClass;
  /** REQUIRED honest rationale (CI-env reason / tracked-bug pointer / cause). */
  note: string;
}

export interface GlobalServerWaiver {
  /** Same-origin-5xx URL pattern unavoidable on ANY route (substring/regex). */
  pattern: string;
  class: WaiverClass;
  note: string;
}

// ---------------------------------------------------------------------------
// Global same-origin-5xx waivers — backend classes structurally unreachable
// from a GitHub Actions runner, so they can 5xx on whatever route happens to
// fetch them. These mirror the two already-known classes the spec waivers
// documented (operations' /coord-api/*, vga's /api/vga/*). Kept global because
// multiple un-spec'd routes can mount a widget that hits the same backend.
// ---------------------------------------------------------------------------

export const GLOBAL_SERVER_WAIVERS: readonly GlobalServerWaiver[] = [
  {
    pattern: "/coord-api/",
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE. /coord-api/* is the Next proxy to the coordination " +
      "server (qontinui-coord). No coord process runs in CI (it lives on " +
      "staging ECS), so every coord-backed widget — fleet status, agent lists, " +
      "merge-train, CI-status — 5xxs through the proxy. Same class the " +
      "operations spec waived (expectedServerErrors:['/coord-api/status']). " +
      "Provisioning a CI-reachable coord is out of scope for the gate; any " +
      "NON-coord same-origin 5xx on a crawled route still reds the gate.",
  },
  {
    pattern: "/api/vga/",
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE. /api/vga/* are Next SERVER routes that connect " +
      "DIRECTLY to PostgreSQL (src/lib/db/vga.ts) rather than proxying to " +
      "api.qontinui.io. The staging RDS is in a private subnet unreachable " +
      "from GitHub Actions runners, so these routes 5xx (no DB). Same class + " +
      "rationale as the vga spec's expectedServerErrors:['/api/vga/state'] " +
      "waiver. Tracked follow-up: give the VGA surface an api.qontinui.io " +
      "proxy (like task-runs/variables) or a CI-reachable read path.",
  },
  {
    pattern: "/api/v1/operations/",
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane, 2026-06-04). /api/v1/operations/* " +
      "are BACKEND proxies to qontinui-coord; the hermetic Spec CI stack " +
      "runs no coord, so the backend correctly 502s them. Spec'd pages get " +
      "prod-parity STUBS instead (hermetic-stubs.ts — strictly stronger: no " +
      "5xx AND the authored render); this waiver covers the long tail of " +
      "coord-backed admin dashboards with no IR spec (/admin/coord/*, " +
      "reachable since the ci-bot superuser-parity step). Same class as " +
      "/coord-api/.",
  },
  {
    pattern: "/api/v1/admin/agent-sessions",
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane). Backend proxy to coord agent " +
      "sessions — no coord in CI; crawl-only route (/admin/agent-sessions). " +
      "Same class as /api/v1/operations/.",
  },
  {
    pattern: "/api/v1/strategy/",
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane). The strategy bridge (coord) is " +
      "disabled in CI — the backend 503s by design. The strategy SPEC " +
      "renders via prod-parity stubs (docs list + content); this waiver " +
      "absorbs the page's un-stubbed background calls (presence/heartbeat " +
      "POSTs, doc thread reads).",
  },
];

// ---------------------------------------------------------------------------
// Per-route waivers — populated from the FIRST gating crawl run's findings,
// each classified + documented. Keyed by the exact crawl route path emitted by
// route-manifest.ts (leading slash). Start EMPTY; the baseline-capture step
// fills this in (see the PR's baseline table). Keep each entry narrow.
// ---------------------------------------------------------------------------

export const PER_ROUTE_WAIVERS: Readonly<Record<string, PerRouteWaiver>> = {
  "/admin/coord/gates": {
    serverPatterns: ["/api/v1/admin-dev/overview"],
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane). /api/v1/admin-dev/overview is the " +
      "backend proxy for the gates & rollout dashboard: it resolves the home " +
      "tenant via coord (GET /admin/coord/me) and forwards to coord " +
      "GET /coord/dev-overview. No coord runs in the hermetic Spec CI stack, so " +
      "the tenant-resolution dependency 502s before the handler runs (the " +
      "handler itself degrades coord-down to an empty 200 + coord_error banner " +
      "in prod). Same class as the /api/v1/operations/ global waiver — a " +
      "coord-backed /admin/coord/* dashboard with no IR spec. Route-scoped " +
      "because exactly one crawl route owns this endpoint.",
  },
};

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface CrawlWaiverResult {
  /** Console errors that survived all waivers (these GATE). */
  unwaivedConsole: ConsoleErrorEntry[];
  /** Same-origin 5xx that survived all waivers (these GATE). */
  unwaivedServer: ServerErrorEntry[];
  /** true if a navigation failure on this route is waived. */
  navFailWaived: boolean;
}

const globalServerMatchers = compilePatterns(GLOBAL_SERVER_WAIVERS.map((w) => w.pattern));

/**
 * Whether a same-origin 5xx URL falls in a GLOBAL waiver class. Exported for
 * the SPEC lane: hermetic CI makes the `ci-env` upstream classes reachable
 * from spec'd pages too (the prod lane only ever hit them in the crawl), so
 * run-spec-ci.ts applies the same global classes where it applies the
 * per-spec `expectedServerErrors` waivers. Per-route waivers stay crawl-only.
 */
export function isGloballyWaivedServerUrl(url: string): boolean {
  return globalServerMatchers.some((rx) => rx.test(url));
}

/**
 * Filter a crawled route's raw findings through the global + per-route waivers.
 * Anything left in `unwaivedConsole`/`unwaivedServer` (or an unwaived nav
 * failure) is a NEW finding that gates, attributed to `routePath`.
 */
export function applyCrawlWaivers(
  routePath: string,
  consoleErrors: ConsoleErrorEntry[],
  serverErrors: ServerErrorEntry[],
): CrawlWaiverResult {
  const waiver = PER_ROUTE_WAIVERS[routePath];
  const routeConsole = compilePatterns(waiver?.consolePatterns ?? []);
  const routeServer = compilePatterns(waiver?.serverPatterns ?? []);

  const unwaivedConsole = consoleErrors.filter(
    (e) => !routeConsole.some((rx) => rx.test(e.text)),
  );
  const unwaivedServer = serverErrors.filter(
    (e) =>
      !globalServerMatchers.some((rx) => rx.test(e.url)) &&
      !routeServer.some((rx) => rx.test(e.url)),
  );

  return {
    unwaivedConsole,
    unwaivedServer,
    navFailWaived: waiver?.allowNavFail === true,
  };
}
