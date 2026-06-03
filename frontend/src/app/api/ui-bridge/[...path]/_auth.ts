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
 * Unauthenticated requests get a flat 401 with no body details (no
 * "token expired" vs "wrong audience" hint that helps an attacker
 * fingerprint the gate). Forbidden origins get a 403. Both responses use
 * the same envelope so the SDK's `_meta.fallback` handling treats them
 * uniformly.
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
  | { ok: false; status: 401 };

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
 */
export async function authenticateBridgeRequest(
  request: NextRequest,
): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, status: 401 };
  }

  const key = tokenKey(token);
  const now = Date.now();
  const cached = positiveCache.get(key);
  if (cached && cached.expiresAt > now) {
    return principalToResult(cached.principal, key, token);
  }

  const base = backendBaseUrl();

  // Path 1: Cognito operator bearer.
  const userPrincipal = await verifyUserToken(base, token);
  if (userPrincipal) {
    positiveCache.set(key, {
      principal: userPrincipal,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    return principalToResult(userPrincipal, key, token);
  }

  // Path 2: coord device-JWT. Only reached when the user path did not
  // resolve a principal (wrong token type or a backend reject).
  const devicePrincipal = await verifyDeviceToken(base, token);
  if (devicePrincipal) {
    positiveCache.set(key, {
      principal: devicePrincipal,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    return principalToResult(devicePrincipal, key, token);
  }

  return { ok: false, status: 401 };
}

/**
 * Verify a Cognito operator bearer against `/api/v1/auth/users/me`.
 * Returns the resolved `user` principal on success, or null on any
 * failure (network error, non-2xx, unparseable body, missing id) — null
 * means "not a valid user bearer", which lets the caller fall through to
 * the device path.
 */
async function verifyUserToken(
  base: string,
  token: string,
): Promise<{ kind: "user"; userId: string } | null> {
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/v1/auth/users/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Network error talking to the backend. Treat as a non-match so a
    // misconfigured `API_URL` doesn't silently grant access.
    return null;
  }
  if (!resp.ok) {
    return null;
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return null;
  }
  const userId = extractUserId(body);
  if (!userId) {
    return null;
  }
  return { kind: "user", userId };
}

/**
 * Verify a coord device-JWT against `/api/v1/devices/me`. Same fetch
 * idiom and base-URL resolution as the user path. Returns the resolved
 * `device` principal (with the paired operator's `userId`) on success, or
 * null on any failure.
 */
async function verifyDeviceToken(
  base: string,
  token: string,
): Promise<{
  kind: "device";
  deviceId: string;
  userId: string;
  tenantId: string;
} | null> {
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/v1/devices/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!resp.ok) {
    return null;
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return null;
  }
  return extractDevicePrincipal(body);
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
