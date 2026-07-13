/**
 * Session-bound auth gate for the UI Bridge relay route.
 *
 * Phase 1 of the production-safe UI Bridge work
 * (plans/2026-05-28-production-safe-ui-bridge-design.md §4.1 + partial §4.3).
 *
 * # Threat model recap
 *
 * The relay route at `/api/ui-bridge/[...path]` proxies into the SDK's
 * CommandRelay, which can read element snapshots, drive clicks, listen to
 * console errors, etc. Without auth, an anonymous internet caller can hit
 * `/api/ui-bridge/control/snapshot` and read the page contents of any
 * registered tab — full session takeover surface.
 *
 * This module supplies the auth check the route wraps every request in.
 *
 * # What this implements
 *
 * 1. **`authenticateBridgeRequest(request)`** — extract the caller's
 *    `Authorization: Bearer` token and verify it against the FastAPI
 *    backend along one of two disjoint paths: a Cognito operator bearer
 *    via `/api/v1/auth/users/me` (resolves a `kind:"user"` principal), or
 *    a coord device-JWT via `/api/v1/devices/me` (resolves a
 *    `kind:"device"` principal whose `userId` is the paired operator).
 *    The user path is tried first; the device path is the fallback. The
 *    resolved principal is returned and positive results are cached for
 *    30s keyed on the token hash to avoid hammering the backend.
 *
 * 2. **`isAllowedOrigin(origin)`** — Origin/Referer allowlist. Production
 *    accepts qontinui.io + *.qontinui.io + *.vercel.app (Vercel preview
 *    URLs use the vercel.app domain). Non-production additionally accepts
 *    `localhost` and `127.0.0.1` for dev tooling. Same-origin server-side
 *    fetches with no Origin header are allowed (Origin is browser-set;
 *    a missing one means the request didn't come from a browser).
 *
 * 3. **`isAuthGateEnabled()`** — the `UI_BRIDGE_REQUIRE_AUTH` env var
 *    gate. Defaults to off so this lands without breaking the existing
 *    SDK transport (which doesn't attach a Bearer header today — see the
 *    cross-link). Future work adds the SDK transport hook and flips the
 *    flag on per environment.
 *
 * # Failure shape
 *
 * Authentication is THREE-state, not two:
 *
 *   - `ok: true`                        — a principal was resolved.
 *   - `ok: false, reason:"unauthenticated"` — the backend rendered an auth
 *     VERDICT and the verdict was "no". Flat 401, no body details (no
 *     "token expired" vs "wrong audience" hint that helps an attacker
 *     fingerprint the gate).
 *   - `ok: false, reason:"upstream_error"` — the backend rendered NO verdict
 *     at all: it was rate-limiting us (429), broken (5xx), or unreachable.
 *     This is NOT an auth failure and MUST NOT be reported as one.
 *
 * That third state is the whole point of the discriminant. Collapsing an
 * upstream 429/5xx into a 401 tells an operator with a perfectly good token
 * that their token is bad — which is actively misleading, and sends whoever
 * is debugging a backend outage or a rate-limit storm hunting the wrong bug.
 * The `AuthResult` failure variants therefore carry NO bare `status` field:
 * a caller cannot read a status off the result and blindly render it as an
 * auth verdict, because the only way to get a status out is to first branch
 * on `reason`. The bug is unrepresentable rather than merely fixed.
 *
 * Upstream errors are surfaced with the upstream's REAL status (429 stays
 * 429, a 502 stays a 502) and its `Retry-After` header when it sent one, so
 * a client's backoff logic sees the truth. Forbidden origins get a 403. All
 * responses use the same envelope so the SDK's `_meta.fallback` handling
 * treats them uniformly.
 *
 * # Cache invariant
 *
 * The positive cache is a per-process in-memory Map keyed on
 * SHA-256(token). It can be re-built at any time (transient miss → backend
 * round-trip). It MUST NOT persist across process restarts (memory only —
 * never written to disk or Redis) so a leaked process snapshot doesn't
 * leak a bearer cache. Vercel lambda restarts naturally enforce this.
 */

import { createHash } from "crypto";
import type { NextRequest } from "next/server";

/* -------------------------------------------------------------------- */
/* Auth-gate flag                                                       */
/* -------------------------------------------------------------------- */

/**
 * True when `UI_BRIDGE_REQUIRE_AUTH=1` is set in the build/runtime env.
 * Read at request time (not at module load) so a runtime config flip
 * takes effect on the next request without a redeploy.
 *
 * Default off keeps the existing SDK transport flow working — the SDK
 * doesn't attach a Bearer header today. A follow-up phase adds the
 * transport-side Authorization header and flips this on per deploy.
 */
export function isAuthGateEnabled(): boolean {
  return process.env.UI_BRIDGE_REQUIRE_AUTH === "1";
}

/* -------------------------------------------------------------------- */
/* Token extraction + verification                                      */
/* -------------------------------------------------------------------- */

/**
 * A successfully-verified principal. Two disjoint token types resolve to
 * two principal kinds:
 *   - `user`   — a Cognito operator bearer verified via `/auth/users/me`.
 *   - `device` — a coord device-JWT verified via `/devices/me`; `userId`
 *     is the PAIRED operator's id (so a device sees its operator's
 *     owned-tab set), `deviceId`/`tenantId` carry the device principal.
 */
type CachedPrincipal =
  | { kind: "user"; userId: string }
  | { kind: "device"; deviceId: string; userId: string; tenantId: string };

interface CachedEntry {
  principal: CachedPrincipal;
  /** Epoch millis after which this cache entry is stale. */
  expiresAt: number;
}

const POSITIVE_TTL_MS = 30_000;

/**
 * Per-process positive-result cache. Keyed on SHA-256(token) so a heap
 * dump doesn't trivially leak the bearer. Negative results are NEVER
 * cached — a token that just refreshed must work on the next request,
 * not after the negative-cache TTL. Holds both user and device
 * principals (the cache key is the token hash, which is unique per token
 * regardless of type).
 */
const positiveCache = new Map<string, CachedEntry>();

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Backend base URL. Matches the project's existing server-side pattern
 * used by `src/app/api/v1/*` route handlers and the `next.config.mjs`
 * `/api/:path*` rewrite: `BACKEND_URL` → `NEXT_PUBLIC_API_URL` → localhost
 * fallback. Reading it directly here (instead of relying on the rewrite
 * via an empty base) makes the gate work on environments that don't ship
 * the rewrite — preview deploys without `BACKEND_URL` set used to fall
 * through to a localhost fetch that no Vercel function can reach.
 */
function backendBaseUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  );
}

/**
 * Result of authenticating a UI Bridge relay request.
 *
 * The success variant is discriminated on `kind`:
 *   - `kind:"user"`   — Cognito operator bearer. `userId` is the operator.
 *   - `kind:"device"` — coord device-JWT. `userId` is the PAIRED operator
 *     (so the device is scoped to its operator's owned tabs); `deviceId`
 *     and `tenantId` carry the device principal for rate-limit namespacing
 *     and downstream attribution.
 *
 * Both success variants carry `token` (the verified incoming bearer, to be
 * forwarded to the audit endpoint) and `tokenKeyHash` (SHA-256 of the token,
 * used as the positive-cache key).
 *
 * The FAILURE variants are discriminated on `reason` — see the "Failure
 * shape" section in the module header. Note that neither failure variant
 * exposes a bare `status`: `unauthenticated` has no status to read (it is
 * always a 401, produced by `unauthenticatedResponse()`), and
 * `upstream_error`'s status is only reachable after branching on `reason`.
 * A caller therefore cannot accidentally render an upstream 429/5xx as an
 * auth verdict — the type forbids it.
 */
export type AuthResult =
  | {
      ok: true;
      kind: "user";
      userId: string;
      tokenKeyHash: string;
      token: string;
    }
  | {
      ok: true;
      kind: "device";
      deviceId: string;
      userId: string;
      tenantId: string;
      tokenKeyHash: string;
      token: string;
    }
  /** The backend rendered an auth verdict, and the verdict was "no". → 401. */
  | { ok: false; reason: "unauthenticated" }
  /**
   * The backend rendered NO verdict — it rate-limited us, fell over, or was
   * unreachable. `status` is the upstream's own status (429 or 5xx; 503 when
   * the fetch never completed) and `retryAfter` is its `Retry-After` header
   * verbatim, when it sent one.
   */
  | {
      ok: false;
      reason: "upstream_error";
      status: number;
      retryAfter: string | null;
    };

/**
 * Outcome of ONE upstream verification probe (`/auth/users/me` or
 * `/devices/me`). Three-state for the same reason `AuthResult` is:
 *
 *   - `match`          — this token is a valid principal of this kind.
 *   - `no-match`       — the backend answered, and the answer was "not this
 *     kind of token" (401/403, or a 2xx whose body carries no usable
 *     principal). The caller may fall through to the other verify path.
 *   - `upstream-error` — the backend never answered the question (429, 5xx,
 *     or a transport failure). Says NOTHING about the token's validity.
 */
type VerifyOutcome<P> =
  | { outcome: "match"; principal: P }
  | { outcome: "no-match" }
  | { outcome: "upstream-error"; status: number; retryAfter: string | null };

/** Sentinel for the two `no-match` returns below (saves re-allocating). */
const NO_MATCH = { outcome: "no-match" } as const;

/**
 * Classify a non-2xx upstream response as either an upstream ERROR (no
 * verdict rendered) or a plain no-match (a verdict of "not this token").
 *
 *   - 429       → upstream error. We are being rate-limited; the backend
 *                 never looked at the token.
 *   - 5xx       → upstream error. The backend is broken.
 *   - any other → no-match. 401/403 is the backend's actual verdict on this
 *                 token; 404/400 means we asked wrong. Either way it is a
 *                 real answer, and the disjoint-path fallback depends on a
 *                 401 from `/auth/users/me` meaning "try the device path".
 *
 * Returns null when the status is not an upstream-error class.
 */
function upstreamErrorFrom(
  resp: Response,
): { outcome: "upstream-error"; status: number; retryAfter: string | null } | null {
  if (resp.status === 429 || resp.status >= 500) {
    return {
      outcome: "upstream-error",
      status: resp.status,
      retryAfter: resp.headers.get("retry-after"),
    };
  }
  return null;
}

/**
 * Authenticate an incoming UI Bridge relay request.
 *
 * Token extraction is Bearer-only: `Authorization: Bearer <jwt>`
 * (the relay transport attaches it on every outbound call). There is no
 * cookie or query fallback — see `extractToken`.
 *
 * Two disjoint verification paths, tried in order:
 *   1. The Cognito operator bearer is verified via the FastAPI
 *      `/api/v1/auth/users/me` endpoint. A 2xx with a `{ id: string }`
 *      body resolves a `kind:"user"` principal.
 *   2. If (and only if) the user path does not resolve a principal, the
 *      same incoming bearer is tried against `/api/v1/devices/me` — a
 *      coord device-JWT. A 2xx with `{ device_id, user_id, tenant_id }`
 *      resolves a `kind:"device"` principal whose `userId` is the paired
 *      operator. `/auth/users/me` rejects a device-JWT (401) and
 *      `/devices/me` rejects a Cognito bearer (401), so the two paths are
 *      disjoint and the order only affects which fetch fires first, never
 *      the outcome.
 *
 * # Upstream errors are not auth verdicts
 *
 * A 429 or 5xx from either verify path means the backend never rendered a
 * verdict on the token. Such a request resolves to `reason:"upstream_error"`
 * carrying the upstream's real status — never a 401.
 *
 * Note that an upstream error on the USER path does NOT short-circuit: we
 * still try the device path. A valid device-JWT must keep authenticating
 * through a transient blip on `/auth/users/me` (the two endpoints can fail
 * independently), so availability wins over saving one fetch. Only when
 * NEITHER path produced a principal do we ask whether the failure was an
 * upstream error or a genuine "no".
 */
export async function authenticateBridgeRequest(
  request: NextRequest,
): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, reason: "unauthenticated" };
  }

  const key = tokenKey(token);
  const now = Date.now();
  const cached = positiveCache.get(key);
  if (cached && cached.expiresAt > now) {
    return principalToResult(cached.principal, key, token);
  }

  const base = backendBaseUrl();

  // Path 1: Cognito operator bearer.
  const user = await verifyUserToken(base, token);
  if (user.outcome === "match") {
    positiveCache.set(key, {
      principal: user.principal,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    return principalToResult(user.principal, key, token);
  }

  // Path 2: coord device-JWT. Reached when the user path did not resolve a
  // principal — whether because the token isn't a Cognito bearer (`no-match`)
  // or because `/auth/users/me` itself was unavailable (`upstream-error`).
  const device = await verifyDeviceToken(base, token);
  if (device.outcome === "match") {
    positiveCache.set(key, {
      principal: device.principal,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    return principalToResult(device.principal, key, token);
  }

  // Neither path resolved a principal. Distinguish "the backend said no"
  // from "the backend never said anything" — only the former is a 401.
  //
  // Precedence when BOTH paths errored: a 429 wins over a 5xx. Both probes
  // hit the same backend, so a rate limit on one is almost certainly the
  // condition on the other, and the 429 is the variant that carries an
  // actionable `Retry-After`. Otherwise the first error observed wins.
  const upstream = pickUpstreamError(user, device);
  if (upstream) {
    return {
      ok: false,
      reason: "upstream_error",
      status: upstream.status,
      retryAfter: upstream.retryAfter,
    };
  }

  // Never cached: a negative verdict must not outlive a token refresh.
  return { ok: false, reason: "unauthenticated" };
}

/**
 * Choose which upstream error (if any) to report when neither verify path
 * produced a principal. Prefers a 429 (carries `Retry-After`); otherwise the
 * first error observed. Returns null when both paths were clean `no-match`es
 * — i.e. the backend genuinely rejected the token, which IS an auth verdict.
 */
function pickUpstreamError(
  ...outcomes: VerifyOutcome<unknown>[]
): { status: number; retryAfter: string | null } | null {
  const errors = outcomes.filter(
    (o): o is Extract<VerifyOutcome<unknown>, { outcome: "upstream-error" }> =>
      o.outcome === "upstream-error",
  );
  const first = errors[0];
  if (!first) return null;
  return errors.find((e) => e.status === 429) ?? first;
}

/**
 * Verify a Cognito operator bearer against `/api/v1/auth/users/me`.
 *
 * Three-state (see `VerifyOutcome`):
 *   - `match`          — 2xx with a usable `{ id }`.
 *   - `upstream-error` — 429 / 5xx / transport failure. The backend never
 *     rendered a verdict; this says nothing about the token.
 *   - `no-match`       — anything else (401/403, or a 2xx whose body carries
 *     no usable id). Lets the caller fall through to the device path.
 */
async function verifyUserToken(
  base: string,
  token: string,
): Promise<VerifyOutcome<{ kind: "user"; userId: string }>> {
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/v1/auth/users/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Transport failure talking to the backend (DNS, refused, timeout). This
    // is an upstream error, NOT a rejection of the token — a misconfigured
    // `BACKEND_URL` must not be reported to the caller as "your token is
    // bad". It still grants nothing: `upstream-error` is a failure state.
    return unreachable();
  }
  if (!resp.ok) {
    return upstreamErrorFrom(resp) ?? NO_MATCH;
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return NO_MATCH;
  }
  const userId = extractUserId(body);
  if (!userId) {
    return NO_MATCH;
  }
  return { outcome: "match", principal: { kind: "user", userId } };
}

/**
 * Verify a coord device-JWT against `/api/v1/devices/me`. Same fetch idiom,
 * base-URL resolution, and three-state contract as the user path; `match`
 * carries the paired operator's `userId`.
 */
async function verifyDeviceToken(
  base: string,
  token: string,
): Promise<
  VerifyOutcome<{
    kind: "device";
    deviceId: string;
    userId: string;
    tenantId: string;
  }>
> {
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/v1/devices/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return unreachable();
  }
  if (!resp.ok) {
    return upstreamErrorFrom(resp) ?? NO_MATCH;
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return NO_MATCH;
  }
  const principal = extractDevicePrincipal(body);
  if (!principal) {
    return NO_MATCH;
  }
  return { outcome: "match", principal };
}

/**
 * The upstream-error outcome for a fetch that never completed. 503 Service
 * Unavailable is the honest status: we could not reach the authority, so we
 * cannot say whether the caller is authenticated.
 */
function unreachable(): {
  outcome: "upstream-error";
  status: number;
  retryAfter: string | null;
} {
  return { outcome: "upstream-error", status: 503, retryAfter: null };
}

/** Build the discriminated `AuthResult` for a verified principal. */
function principalToResult(
  principal: CachedPrincipal,
  tokenKeyHash: string,
  token: string,
): AuthResult {
  if (principal.kind === "user") {
    return {
      ok: true,
      kind: "user",
      userId: principal.userId,
      tokenKeyHash,
      token,
    };
  }
  return {
    ok: true,
    kind: "device",
    deviceId: principal.deviceId,
    userId: principal.userId,
    tenantId: principal.tenantId,
    tokenKeyHash,
    token,
  };
}

function extractToken(request: NextRequest): string | null {
  // Bearer-only. The SDK's command-relay transport
  // (@qontinui/ui-bridge ≥ 0.11.0) attaches `Authorization: Bearer <jwt>`
  // to every outbound call — POST /commands, POST /heartbeat, AND the
  // streaming GET /commands/stream (which switched from EventSource to
  // fetch precisely so it could send headers). There is no longer a
  // cookie / query fallback.
  //
  // Why drop the cookie path: cross-origin cookies are CSRF-vulnerable
  // (a logged-in user visiting a malicious site has bank.com's cookies
  // auto-attached on cross-origin requests). Authorization headers
  // require CORS preflight for cross-origin, and JWTs in sessionStorage
  // are not auto-attached by the browser at all. Bearer-only =
  // CSRF-resistant by construction; one code path; one threat model.
  // Local dev uses Bearer the same as prod (TokenStorage already
  // mirrors to sessionStorage in every mode).
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^bearer\s+(.+)$/i.exec(auth);
    const candidate = m?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function extractUserId(body: unknown): string | null {
  if (body && typeof body === "object" && "id" in body) {
    const id = (body as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/**
 * Pull the device principal out of a `/api/v1/devices/me` response body.
 * Requires all three of `device_id`, `user_id`, `tenant_id` as non-empty
 * strings — a partial body is treated as a non-match (returns null).
 */
function extractDevicePrincipal(body: unknown): {
  kind: "device";
  deviceId: string;
  userId: string;
  tenantId: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    device_id?: unknown;
    user_id?: unknown;
    tenant_id?: unknown;
  };
  const deviceId = b.device_id;
  const userId = b.user_id;
  const tenantId = b.tenant_id;
  if (
    typeof deviceId === "string" &&
    deviceId.length > 0 &&
    typeof userId === "string" &&
    userId.length > 0 &&
    typeof tenantId === "string" &&
    tenantId.length > 0
  ) {
    return { kind: "device", deviceId, userId, tenantId };
  }
  return null;
}

/* -------------------------------------------------------------------- */
/* Response helpers                                                     */
/* -------------------------------------------------------------------- */

export function unauthenticatedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "UNAUTHENTICATED",
      message: "UI Bridge relay requires a valid session token",
    }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Response for the `upstream_error` auth outcome: the identity backend did
 * not render a verdict on the caller's token, so we must not pretend it
 * rendered a negative one.
 *
 * The upstream's REAL status is passed through (429 stays 429, 502 stays
 * 502) along with its `Retry-After` header when it sent one, so client-side
 * backoff sees the truth instead of a 401 it can only respond to by throwing
 * away a perfectly good token. The `code` distinguishes the rate-limit case
 * from the outage case for log greppability; both are explicitly NOT
 * `UNAUTHENTICATED`.
 *
 * `status` is defensively clamped to a class this helper is willing to emit
 * (429, or 5xx) — a 502 stands in for anything unexpected — so the helper is
 * total and can never throw a `RangeError` out of the request path.
 */
export function upstreamErrorResponse(result: {
  status: number;
  retryAfter: string | null;
}): Response {
  const status =
    result.status === 429 || (result.status >= 500 && result.status <= 599)
      ? result.status
      : 502;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (result.retryAfter) {
    headers["Retry-After"] = result.retryAfter;
  }
  return new Response(
    JSON.stringify({
      success: false,
      code: status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_UNAVAILABLE",
      message:
        status === 429
          ? "UI Bridge relay could not verify the session token: the identity backend is rate-limiting requests"
          : "UI Bridge relay could not verify the session token: the identity backend is unavailable",
    }),
    { status, headers },
  );
}

export function originForbiddenResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "ORIGIN_NOT_ALLOWED",
      message: "UI Bridge relay does not accept requests from this origin",
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/* -------------------------------------------------------------------- */
/* Origin allowlist                                                     */
/* -------------------------------------------------------------------- */

/**
 * Returns true when `origin` is on the relay's allowlist for the
 * current environment. A missing/null Origin is allowed — Origin is
 * browser-set; its absence indicates a server-to-server fetch that
 * didn't originate cross-origin in any browser context.
 *
 * Production allowlist:
 *   - qontinui.io and any `*.qontinui.io` subdomain
 *   - any `*.vercel.app` (Vercel preview/prod deploys)
 *
 * Non-production additionally accepts `localhost` and `127.0.0.1` on
 * any port for dev tooling.
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "qontinui.io") return true;
  if (host.endsWith(".qontinui.io")) return true;
  if (host.endsWith(".vercel.app")) return true;
  if (process.env.NODE_ENV !== "production") {
    if (host === "localhost" || host === "127.0.0.1") return true;
  }
  return false;
}

/* -------------------------------------------------------------------- */
/* Test hooks                                                           */
/* -------------------------------------------------------------------- */

/**
 * Clear the positive cache. Test-only hook — production code paths
 * NEVER call this. Cache invariant: the only way to invalidate a
 * positive entry is the 30s TTL.
 */
export function __resetAuthCache(): void {
  positiveCache.clear();
}
