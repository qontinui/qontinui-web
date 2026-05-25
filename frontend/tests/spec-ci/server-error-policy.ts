/**
 * Same-origin HTTP-500 policy for Spec CI — the run-level invariant that gives
 * the gate HTTP-RESPONSE visibility, a class of failure the console-error
 * invariant (`console-policy.ts`) structurally cannot see.
 *
 * Why a separate module from `console-policy.ts`:
 *   - The console invariant classifies BROWSER CONSOLE / pageerror events (JS
 *     runtime signal). This invariant classifies HTTP RESPONSE STATUS (backend
 *     signal). They are orthogonal axes — a backend `fetch()` to a route that
 *     returns 500 RESOLVES with `response.ok === false` and throws NOTHING, so
 *     no console.error and no pageerror is emitted; the 500 is invisible to the
 *     console listener. Keeping the policies in separate files lets each be
 *     reviewed/diffed in isolation and keeps this change entirely out of
 *     `console-policy.ts`'s console-error classification.
 *
 * v1 semantics:
 *   - A response GATES iff (a) its URL origin === the page's base origin (the
 *     localhost:3001 Next proxy — i.e. a same-origin app/API call, NOT a
 *     third-party request) AND (b) `status() >= 500`.
 *   - Same-origin scoping is deliberate: the harness proxies to a REMOTE
 *     staging API, and in-flight background fetches aborted on navigation
 *     surface as NETWORK-LAYER rejects (handled by `console-policy.ts`'s
 *     `NETWORK_NOISE_DENYLIST`). Those are not HTTP 500 RESPONSES — different
 *     signal entirely. A same-origin 5xx is, by contrast, the Next proxy
 *     reporting that the app route or the backend it fronts actually errored:
 *     the exact systemic blind spot this invariant closes.
 *   - A per-spec `metadata.expectedServerErrors` waiver (mirror of
 *     `expectedConsoleErrors`) lets a spec that legitimately exercises an error
 *     path waive a specific same-origin 5xx by URL substring/regex. Author NONE
 *     unless a real one surfaces.
 */

/**
 * Captured same-origin HTTP-5xx response, attributed to the spec (and, when
 * known, the transition) that was executing when it landed. Per-transition
 * attribution is `null`/"initial-load" for the same reason as
 * `ConsoleErrorEntry`: the in-page transition walk runs inside `page.evaluate`,
 * opaque to the outer `page.on("response")` listener.
 */
export interface ServerErrorEntry {
  specId: string;
  transitionId: string | null;
  /** Full response URL (same-origin only — see `isSameOriginServerError`). */
  url: string;
  status: number;
  /** HTTP method of the originating request, for triage ("GET"/"POST"/…). */
  method: string;
  ts: number;
}

/**
 * Classify an HTTP response into gate-relevance for the same-origin 500
 * invariant. Returns `true` iff the response is BOTH same-origin (its URL
 * origin equals `baseOrigin`) AND a server error (`status >= 500`).
 *
 * @param responseUrl the response's full URL (`response.url()`).
 * @param status      the HTTP status (`response.status()`).
 * @param baseOrigin  the page's base origin (e.g. `http://localhost:3001`).
 */
export function isSameOriginServerError(
  responseUrl: string,
  status: number,
  baseOrigin: string,
): boolean {
  if (status < 500) return false;
  let origin: string;
  try {
    origin = new URL(responseUrl).origin;
  } catch {
    // A malformed/relative URL can't be confirmed same-origin; don't gate on it
    // (it's not the localhost-proxy app/API signal this invariant targets).
    return false;
  }
  return origin === baseOrigin;
}

/**
 * Compile a spec's `metadata.expectedServerErrors` waiver list (substring or
 * regex strings, matched against the response URL) into matchers. Invalid regex
 * falls back to a literal-escaped match so an author's plain-substring waiver
 * always works. Returns `[]` when the field is absent or malformed (the common
 * case — default is "must be free of same-origin 5xx"). Mirrors
 * `compileExpectedConsoleErrors` exactly.
 */
export function compileExpectedServerErrors(raw: unknown): RegExp[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => {
      try {
        return new RegExp(s);
      } catch {
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }
    });
}
