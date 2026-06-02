/**
 * Best-effort reporter: ship spec-CI's same-origin HTTP-5xx findings to coord's
 * Ξ_Log corroboration ingest as a CORROBORATING second observer.
 *
 * The spec-CI gate already DETECTS same-origin 5xx during a run (see
 * `server-error-policy.ts` / `ServerErrorEntry`); those records are the
 * client-side observation of a server error. Coord folds them into the
 * `coord.error_observations` Ξ_Log oplog alongside its own server-side
 * observations. This reporter is the shipping leg of that pipeline.
 *
 * Hard requirements (all enforced below):
 *   - Activates ONLY when BOTH `COORD_HTTP_URL` and `COORD_INGEST_TOKEN` are set.
 *     Either unset → silent no-op (local runs / forks / PRs from forks never
 *     report; the secrets simply aren't in their env).
 *   - Fully best-effort + non-blocking: a short timeout, try/catch around
 *     everything, ALL errors swallowed into a single `console.warn`. The
 *     spec-CI run MUST NOT fail or hang if coord is unreachable, slow, or
 *     returns a non-2xx. Returns `void` (resolved Promise<void>).
 *   - Does NOT touch the gate. This is observability only; the caller fires it
 *     regardless of pass/fail and ignores its result.
 *   - No bodies / no PII leave the runner: `sample` is route+status only.
 */

/** Minimal shape this reporter consumes — a structural subset of `ServerErrorEntry`. */
export interface ReportableServerError {
  /** Full response URL (same-origin only). */
  url: string;
  /** HTTP status (>= 500). */
  status: number;
  /** Originating HTTP method ("GET"/"POST"/…). */
  method: string;
}

/** Per-`(route,status)` aggregated event — the exact element shape coord parses. */
interface CoordEvent {
  route: string;
  method: string;
  status: number;
  count: number;
  sample: string;
}

/** Exact request-body contract coord's `/coord/log/spec-ci-500` ingest parses. */
interface CoordIngestBody {
  surface: string;
  release: string | null;
  events: CoordEvent[];
}

/** How long to wait on coord before giving up. Best-effort: never block the run. */
const COORD_REPORT_TIMEOUT_MS = 5000;

/**
 * Reduce a full response URL to a stable route key (pathname only). Strips the
 * origin (host varies: localhost-proxy vs. prod) and the query string (may carry
 * ids / tokens — PII-adjacent). Falls back to the raw string only if the URL is
 * unparseable (it should always parse — these are real `response.url()` values).
 */
function urlToRoute(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Aggregate `ServerErrorEntry`-shaped records into one `CoordEvent` per
 * `(route, method, status)`, summing `count`. `sample` is a SHORT scrubbed
 * string — route + status ONLY, deliberately no response body / no query / no
 * headers — so nothing sensitive leaves the runner.
 */
export function buildCoordEvents(records: ReadonlyArray<ReportableServerError>): CoordEvent[] {
  const byKey = new Map<string, CoordEvent>();
  for (const r of records) {
    const route = urlToRoute(r.url);
    const key = `${r.method} ${route} ${r.status}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, {
        route,
        method: r.method,
        status: r.status,
        count: 1,
        sample: `${route} ${r.status}`,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * POST the collected same-origin 5xx records to coord's Ξ_Log corroboration
 * ingest. Best-effort + non-blocking: returns `void`, never throws, never
 * rejects, never blocks the run on a slow/unreachable coord.
 *
 * No-op (returns immediately, no network) when EITHER `COORD_HTTP_URL` or
 * `COORD_INGEST_TOKEN` is unset, OR there are zero records to report.
 *
 * @param records the same-origin 5xx records collected across the whole run.
 */
export async function reportServerErrorsToCoord(
  records: ReadonlyArray<ReportableServerError>,
): Promise<void> {
  try {
    const coordUrl = process.env.COORD_HTTP_URL;
    const token = process.env.COORD_INGEST_TOKEN;
    // Both secrets required — absent on local runs / fork PRs → silent no-op.
    if (!coordUrl || !token) return;

    const events = buildCoordEvents(records);
    // Nothing to corroborate — don't bother coord with an empty observation.
    if (events.length === 0) return;

    const body: CoordIngestBody = {
      surface: process.env.COORD_SPEC_CI_SURFACE || "web-prod",
      release: process.env.GITHUB_SHA || null,
      events,
    };

    const endpoint = `${coordUrl.replace(/\/+$/, "")}/coord/log/spec-ci-500`;

    // Short bounded timeout — best-effort, must never hang the run.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COORD_REPORT_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Non-2xx is NOT a run failure — corroboration is best-effort.
        console.warn(
          `[spec-ci] coord 500-reporter: ingest returned HTTP ${res.status} ` +
            `(${events.length} event(s) not corroborated; non-fatal)`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Swallow EVERYTHING (network down, abort/timeout, bad URL, JSON error, …):
    // the spec-CI run must not fail or hang because coord is unreachable.
    console.warn(
      `[spec-ci] coord 500-reporter: skipped (non-fatal) — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
