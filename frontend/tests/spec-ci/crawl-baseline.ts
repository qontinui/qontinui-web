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
 *      runner (no coord process; private-subnet RDS). They began as the two
 *      classes the spec waivers documented (`/coord-api/*`, `/api/vga/*`) and
 *      now also cover the coord-backed backend proxies — see the list itself
 *      for the current set rather than a count here. An entry may be scoped
 *      to specific `statuses`. A page-route waiver is preferred when the
 *      finding is route-specific; a global waiver is only for a backend class
 *      that no single route "owns".
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
  /**
   * The ONLY statuses this waiver tolerates on a matching URL. Absent means
   * every 5xx is waived — the behaviour every entry had before this field
   * existed, so no existing entry changes.
   *
   * Present, it is what stops a waiver for an environment gap from also
   * swallowing a real bug on the same URLs. A URL-substring waiver cannot
   * tell "coord is unreachable in CI" from "this handler crashed": both are
   * a same-origin 5xx on the same path. The status can. So an entry that
   * exists because an upstream is absent should list exactly the statuses
   * that absence produces, and nothing else — anything outside the list
   * still gates, which keeps the gate guarding the code it covers.
   */
  statuses?: readonly number[];
  class: WaiverClass;
  note: string;
}

// ---------------------------------------------------------------------------
// Global same-origin-5xx waivers — backend classes structurally unreachable
// from a GitHub Actions runner, so they can 5xx on whatever route happens to
// fetch them. They began as the two classes the spec waivers documented
// (operations' /coord-api/*, vga's /api/vga/*); the list below is the current
// set. Kept global because multiple un-spec'd routes can mount a widget that
// hits the same backend.
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
      "sessions — no coord in CI. The /admin/agent-sessions ROUTE was " +
      "deleted by 2026-08-26-sessions-console-consolidation Phase 3, but " +
      "the API it proxied is still read by /sessions and /sessions/[key] " +
      "(the resolver). Same class as /api/v1/operations/.",
  },
  {
    // Anchored on the PATH, not a bare substring: a bare "/api/v1/overview/"
    // would also match a same-origin URL carrying it in a query value, e.g.
    // `…/api/v1/x?next=/api/v1/overview/…`, since fetch does not encode `/`.
    pattern: "^https?://[^/]+/api/v1/overview/",
    // Status-scoped, deliberately: see `statuses` on GlobalServerWaiver.
    statuses: [502, 504],
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane), STATUS-SCOPED. /api/v1/overview/* " +
      "(the Project Overview's estimate, settings and rollup reads) resolve " +
      "the ACTIVE tenant through coord (get_coord_identity -> GET " +
      "/admin/coord/me) in a DEPENDENCY, before any handler body runs. No " +
      "coord runs in the hermetic Spec CI stack, so that dependency fails — " +
      "and coord_identity._fetch_identity maps exactly that failure to 502 (a " +
      "connect error) or 504 (a timeout). Those two statuses, and only those, " +
      "are waived. " +
      "What the scoping does and does NOT protect, stated precisely: in this " +
      "lane the handler BODIES are never reached — the coord dependency 502s " +
      "first — so a bug inside a handler cannot surface here at all, waived " +
      "or not. What still gates is a 500 from anything that runs BEFORE or " +
      "INSTEAD OF the coord call: authentication, the DB-session dependency, " +
      "an httpx transport error _fetch_identity does not catch (it becomes a " +
      "500), or a proxy fault. A blanket substring entry would have waived " +
      "those too. It also means the day coord or a hermetic stub exists for " +
      "these routes, their handler 500s gate with no change here.",
  },
];

// ---------------------------------------------------------------------------
// Per-route waivers — populated from the FIRST gating crawl run's findings,
// each classified + documented. Keyed by the exact crawl route path emitted by
// route-manifest.ts (leading slash). Start EMPTY; the baseline-capture step
// fills this in (see the PR's baseline table). Keep each entry narrow.
// ---------------------------------------------------------------------------

export const PER_ROUTE_WAIVERS: Readonly<Record<string, PerRouteWaiver>> = {
  "/admin/coord/agent-registry": {
    serverPatterns: ["/api/v1/agent-registry/admin/"],
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane). /api/v1/agent-registry/admin/* are " +
      "the two ADMIN proxies behind the tenant-default editor: both depend on " +
      "require_coord_tenant_admin, which resolves the operator's tenant and " +
      "role via coord (GET /admin/coord/me) before either handler runs. No " +
      "coord runs in the hermetic Spec CI stack, so that dependency 502s and " +
      "the page's on-mount read never reaches its own handler. Same class as " +
      "the /api/v1/operations/ global waiver — a coord-backed /admin/coord/* " +
      "dashboard with no IR spec. Route-scoped because exactly one crawl route " +
      "owns these endpoints. " +
      "The pattern is deliberately anchored on the /admin/ segment: the " +
      "PER-USER routes on the same router (/api/v1/agent-registry and " +
      "/api/v1/agent-registry/prefs/*, which /settings/agents drives) are NOT " +
      "waived, so a real regression on them still reds the gate. " +
      "Strictly stronger follow-up: give this page an IR spec + prod-parity " +
      "hermetic stub, which would assert the authored render instead of only " +
      "tolerating the 5xx.",
  },
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
  "/admin/coord/prompt-injections": {
    serverPatterns: ["/api/v1/admin/prompt-injections"],
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane). /api/v1/admin/prompt-injections is " +
      "the backend proxy for the prompt-injection audit log dashboard: it " +
      "forwards the caller bearer to coord GET /coord/prompt-injections. No " +
      "coord runs in the hermetic Spec CI stack, so the proxy correctly 502s " +
      "(_proxy_coord_get maps httpx.ConnectError -> 502 'coord is not " +
      "reachable'). Same class as the /api/v1/operations/ global waiver — a " +
      "coord-backed /admin/coord/* dashboard with no IR spec. Route-scoped " +
      "because exactly one crawl route owns this endpoint; the pattern is a " +
      "prefix so the /{event_id} detail read is covered by the same entry.",
  },
  "/conditions": {
    serverPatterns: ["/api/v1/conditions/"],
    class: "ci-env",
    note:
      "CI-ENV-UNAVOIDABLE (hermetic lane). /api/v1/conditions/* is the backend " +
      "proxy for the Regression Tests page: get_tenant_id resolves the home " +
      "tenant via coord (GET /admin/coord/me) and forwards to coord's " +
      "/coord/condition-groups. No coord runs in the hermetic Spec CI stack, so " +
      "the tenant-resolution dependency 502s before data loads. Unlike the " +
      "superuser-gated /admin/coord/* pages (whose gate stops the crawler before " +
      "the fetch), /conditions is a regular-user page, so the authenticated " +
      "crawler reaches the coord-backed fetch. Same class as the " +
      "/api/v1/operations/ global waiver. Route-scoped because exactly one crawl " +
      "route owns this endpoint.",
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

interface CompiledGlobalWaiver {
  matcher: RegExp;
  /** `undefined` = every status (the pre-`statuses` behaviour). */
  statuses: ReadonlySet<number> | undefined;
}

const globalServerWaivers: readonly CompiledGlobalWaiver[] =
  GLOBAL_SERVER_WAIVERS.map((w) => ({
    matcher: compilePatterns([w.pattern])[0] as RegExp,
    statuses: w.statuses ? new Set(w.statuses) : undefined,
  }));

/**
 * Whether a same-origin 5xx falls in a GLOBAL waiver class — matched on its
 * URL, and, for a waiver that lists `statuses`, on its status as well.
 *
 * `status` is REQUIRED rather than optional, so a caller has to state what it
 * saw. Be precise about how much that buys: `tests/` is excluded from the
 * project tsconfig, so neither `npm run type-check` nor `tsx` enforces the
 * signature in CI, and nothing type-checks the call in `run-spec-ci.ts`. It
 * documents the contract; it does not guarantee it. The failure mode if a
 * caller dropped the argument is at least the safe one: `status` would be
 * `undefined`, pattern-only entries would still waive as before, and a
 * status-scoped entry would stop waiving — the gate fails CLOSED, never open.
 *
 * Exported for the SPEC lane: hermetic CI makes the `ci-env` upstream classes
 * reachable from spec'd pages too (the prod lane only ever hit them in the
 * crawl), so run-spec-ci.ts applies the same global classes where it applies
 * the per-spec `expectedServerErrors` waivers. Per-route waivers stay
 * crawl-only.
 */
export function isGloballyWaivedServerUrl(
  url: string,
  status: number
): boolean {
  return globalServerWaivers.some(
    (w) =>
      w.matcher.test(url) &&
      (w.statuses === undefined || w.statuses.has(status))
  );
}

/**
 * Filter a crawled route's raw findings through the global + per-route waivers.
 * Anything left in `unwaivedConsole`/`unwaivedServer` (or an unwaived nav
 * failure) is a NEW finding that gates, attributed to `routePath`.
 */
export function applyCrawlWaivers(
  routePath: string,
  consoleErrors: ConsoleErrorEntry[],
  serverErrors: ServerErrorEntry[]
): CrawlWaiverResult {
  const waiver = PER_ROUTE_WAIVERS[routePath];
  const routeConsole = compilePatterns(waiver?.consolePatterns ?? []);
  const routeServer = compilePatterns(waiver?.serverPatterns ?? []);

  const unwaivedConsole = consoleErrors.filter(
    (e) => !routeConsole.some((rx) => rx.test(e.text))
  );
  const unwaivedServer = serverErrors.filter(
    (e) =>
      !isGloballyWaivedServerUrl(e.url, e.status) &&
      !routeServer.some((rx) => rx.test(e.url))
  );

  return {
    unwaivedConsole,
    unwaivedServer,
    navFailWaived: waiver?.allowNavFail === true,
  };
}
