/**
 * Per-principal, per-minute rate limit for the UI Bridge relay (§4.8 of the
 * production-safe plan).
 *
 * # The property
 *
 * The limit exists to defang COMMAND flooding (§4.8 threat row, "DoS via
 * command flooding"): a principal that sends commands through the relay is
 * bounded however many tabs it has. A user with 5 tabs gets one command
 * budget, not 5× the budget — every counter is keyed on the principal, never
 * on a tab, so N tabs buy no command budget at all.
 *
 * # The lanes
 *
 * Every request draws on exactly ONE lane, chosen from its path and method
 * alone (`laneFor`), before any body is read:
 *
 *   - `read`  (GET/HEAD) and `write` (everything else) — the COMMAND lanes,
 *     60 and 20 per principal per minute.
 *   - three TRANSPORT sub-lanes for the SDK's own bookkeeping
 *     (`_transport.ts`): `transport:stream` (`GET /commands/stream`),
 *     `transport:heartbeat` (`POST /heartbeat`) and `transport:result`
 *     (`POST /commands`, a tab posting a command's result).
 *
 * Transport is not a command. Charged to the command lanes, a principal's own
 * tabs starved its commands and each other. By the SDK's 10-s heartbeat
 * timer, four idle tabs alone pass 20 writes a minute, and every relayed
 * command costs a second request when the tab answers it. The measured case
 * (2026-11-08, coord finding e0735415): one agent relay tab beside three
 * operator tabs drew 29 x 429, a command timeout and TAB_STALE. Plan
 * 2026-11-08-an-agents-relay-tab-spends-the-operators-ui-bridge-budget. So
 * transport has its own lanes, and the command lanes measure commands only.
 *
 * Transport is still BOUNDED per principal, one sub-lane per route, so
 * no route's bound is lifted to a pooled total. Each ceiling is computed from
 * an envelope of `TRANSPORT_ENVELOPE_TABS` live tabs and
 * `TRANSPORT_ENVELOPE_DRIVERS` principals concurrently driving them, at the
 * SDK cadences `_transport.ts` restates:
 *
 *   - stream:    16 tabs × 6 opens/min (the reconnect cadence)          =  96
 *   - heartbeat: 16 tabs × (6 timer + 4 ping-driven beats)/min          = 160
 *   - result:    16 tabs × 2 relay snapshots × 6 opens/min
 *                + 3 drivers × (60 + 20) commands/min                   = 432
 *
 * A refusal on a transport sub-lane is `TRANSPORT_RATE_LIMITED`, naming the
 * lane — the envelope, not the caller's command budget. The SDK discards the
 * response to a heartbeat or a result, so `route.ts` also logs refusals
 * server-side (`logLaneRefused`, sampled by overflow).
 *
 * Window: clock-aligned minute. Counter key embeds the lane and the minute
 * index so a principal can't carry budget across a window boundary, and the
 * keys naturally expire (we set EXPIRE 70s on each INCR — slightly larger
 * than the window so a final INCR near the boundary doesn't lose its TTL).
 * One request is one INCR on one key.
 *
 * Every response the relay returns after the check carries the budget of
 * the lane it drew on (`X-RateLimit-Lane`, `-Limit`, `-Remaining`,
 * `-Reset-After`), so a client can pace itself.
 *
 * # Failure mode (CRITICAL)
 *
 * The relay's core function is AUTHENTICATION, not rate limiting. If
 * Redis is unreachable (`UI_BRIDGE_RELAY_REDIS_URL` unset, network
 * error, AUTH error), this module returns `{ok: true, allowed: true,
 * redisOffline: true}` — fail OPEN. Failing closed would tear down the
 * bridge for every user the moment Redis hiccups, which is much worse
 * than briefly disabling rate limits. A connection that exists but is not
 * ready yet is the same case (`incrAndGet`). The remaining budget is then
 * unknown, and the `X-RateLimit-Remaining` header says exactly that.
 *
 * The framework's robustness priority says "fail predictably." We pick
 * the failure direction that keeps the system in its more useful state:
 * authenticated users keep working; the rate cap is just one of the
 * hygiene layers, behind auth + audit.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import IORedis, { type Redis } from "ioredis";

import { createLogger } from "@/lib/logger";

import {
  HEARTBEATS_PER_TAB_PER_MIN,
  RELAY_RESULTS_PER_TAB_PER_MIN,
  sdkTransportLane,
  STREAM_OPENS_PER_TAB_PER_MIN,
  type SdkTransportLane,
} from "./_transport";

const log = createLogger("UIBridgeRateLimit");

/* -------------------------------------------------------------------- */
/* Limits + window                                                      */
/* -------------------------------------------------------------------- */

export const READ_LIMIT_PER_MIN = 60;
export const WRITE_LIMIT_PER_MIN = 20;
const WINDOW_MS = 60_000;
/** TTL on each minute-window counter key (slightly > the window). */
const COUNTER_TTL_SEC = 70;

/** Live tabs one principal is sized for, across all its transport sub-lanes. */
export const TRANSPORT_ENVELOPE_TABS = 16;
/** Principals sized to be driving one principal's tabs at the same time. */
export const TRANSPORT_ENVELOPE_DRIVERS = 3;

export const TRANSPORT_STREAM_LIMIT_PER_MIN =
  TRANSPORT_ENVELOPE_TABS * STREAM_OPENS_PER_TAB_PER_MIN;
export const TRANSPORT_HEARTBEAT_LIMIT_PER_MIN =
  TRANSPORT_ENVELOPE_TABS * HEARTBEATS_PER_TAB_PER_MIN;
/**
 * The results a principal's tabs post are the relay's own snapshots plus the
 * commands its drivers send them — each driver bounded by its own command
 * lanes, read and write.
 */
export const TRANSPORT_RESULT_LIMIT_PER_MIN =
  TRANSPORT_ENVELOPE_TABS * RELAY_RESULTS_PER_TAB_PER_MIN +
  TRANSPORT_ENVELOPE_DRIVERS * (READ_LIMIT_PER_MIN + WRITE_LIMIT_PER_MIN);

/** The lane a request draws on: a command lane or a transport sub-lane. */
export type RateLimitKind = "read" | "write" | `transport:${SdkTransportLane}`;

/**
 * Each lane's ceiling and its counter-key prefix. The prefixes are distinct
 * (`r`, `w`, `t:s`, `t:h`, `t:c`), so no two lanes ever share a counter.
 */
const LANES: Readonly<
  Record<RateLimitKind, { limit: number; keyPrefix: string }>
> = {
  read: { limit: READ_LIMIT_PER_MIN, keyPrefix: "r" },
  write: { limit: WRITE_LIMIT_PER_MIN, keyPrefix: "w" },
  "transport:stream": {
    limit: TRANSPORT_STREAM_LIMIT_PER_MIN,
    keyPrefix: "t:s",
  },
  "transport:heartbeat": {
    limit: TRANSPORT_HEARTBEAT_LIMIT_PER_MIN,
    keyPrefix: "t:h",
  },
  "transport:result": {
    limit: TRANSPORT_RESULT_LIMIT_PER_MIN,
    keyPrefix: "t:c",
  },
};

function isTransportLane(kind: RateLimitKind): boolean {
  return kind.startsWith("transport:");
}

/* -------------------------------------------------------------------- */
/* Client singleton                                                     */
/* -------------------------------------------------------------------- */

/**
 * Tri-state: `undefined` = not yet initialized; `null` = explicitly
 * offline (env unset or connect failed — fail-open lane); `Redis` = ready.
 *
 * Lazy-initialized on first request so module import has no side effect
 * (vitest can swap the client via `__setRedisClientForTest` without
 * having to mock module-load behavior).
 */
let client: Redis | null | undefined;

function resolveUrl(): string | null {
  const u = process.env.UI_BRIDGE_RELAY_REDIS_URL;
  return u && u.length > 0 ? u : null;
}

function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = resolveUrl();
  if (!url) {
    log.info("redis_url_unset_failing_open");
    client = null;
    return null;
  }
  try {
    const c = new IORedis(url, {
      // Keep retry behavior minimal — on any persistent failure we'd
      // rather fail-open quickly than hold up the request.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    c.on("error", (err: Error) => {
      // Don't log on every retry — ioredis emits these in storms. One
      // line at warn-level is enough for an operator to notice.
      log.warn("redis_error_failing_open", { error: err.message });
    });
    client = c;
    return c;
  } catch (err) {
    log.warn("redis_init_failed_failing_open", {
      error: err instanceof Error ? err.message : String(err),
    });
    client = null;
    return null;
  }
}

/* -------------------------------------------------------------------- */
/* Test hooks                                                           */
/* -------------------------------------------------------------------- */

/**
 * Test-only: inject a mock redis client (or null to simulate offline).
 * Production code MUST NOT call this.
 */
export function __setRedisClientForTest(c: Redis | null | undefined): void {
  client = c;
}

/* -------------------------------------------------------------------- */
/* Check API                                                            */
/* -------------------------------------------------------------------- */

export interface RateLimitResult {
  /** True when the request may proceed (either under limit OR Redis offline). */
  allowed: boolean;
  /**
   * Current count in the active minute window AFTER this call's INCR.
   * Zero when Redis is offline (no count to report).
   */
  count: number;
  /** Configured ceiling for this kind. */
  limit: number;
  /** Seconds until the current minute window rolls over. */
  retryAfterSec: number;
  /** True when Redis was unreachable; the call passed through fail-open. */
  redisOffline: boolean;
  /** The lane this request drew on. */
  kind: RateLimitKind;
}

function currentWindowIndex(now: number = Date.now()): number {
  return Math.floor(now / WINDOW_MS);
}

function secondsUntilNextWindow(now: number = Date.now()): number {
  const windowEnd = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
  return Math.max(1, Math.ceil((windowEnd - now) / 1000));
}

function keyFor(userId: string, kind: RateLimitKind, windowIdx: number): string {
  // Short lane prefixes keep the Redis bill predictable.
  return `bridge:rl:${LANES[kind].keyPrefix}:${userId}:${windowIdx}`;
}

/**
 * Atomically INCR the per-(principal, lane, window) counter. On the first
 * INCR of a window the EXPIRE is set so the key self-cleans.
 *
 * Pipeline gives us both ops in one RTT; the INCR result is what we
 * compare against the limit. The EXPIRE return is fire-and-forget
 * (success/failure doesn't gate the request).
 *
 * THROWS when the pipeline yields no count. With `enableOfflineQueue: false`
 * ioredis does not reject a pipeline sent on a connection that is not ready
 * yet (every cold instance's first request, and every request while Redis is
 * down): it RESOLVES it with an error per command. Read as a count of 0, that
 * admitted the request as counted and reported a full budget; thrown, it takes
 * `checkRateLimit`'s fail-open path, which says the count is unknown.
 */
async function incrAndGet(key: string, redis: Redis): Promise<number> {
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, COUNTER_TTL_SEC);
  const results = await pipeline.exec();
  const incrResult = results?.[0];
  if (!incrResult) {
    throw new Error("redis pipeline returned no INCR result");
  }
  const [err, value] = incrResult;
  if (err) {
    throw err;
  }
  const count = Number(value);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`redis INCR returned ${String(value)}, not a count`);
  }
  return count;
}

/** The minute window of the last fail-open warning this process logged. */
let lastFailOpenLogWindow: number | null = null;

/**
 * Warn that a Redis op failed and the limiter is failing open — at most once
 * per minute window per process, because during an outage EVERY request
 * takes this path.
 *
 * `status` is the client's connection state (ioredis `Redis.status`); the
 * error message alone is the same for a cold start and an outage.
 * `reconnecting` or `end` means an outage. `connecting` is EITHER case: a
 * cold instance's first request ran before its connection was ready, or an
 * outage is between retries (ioredis passes back through `connecting` on
 * every reconnect attempt). Repetition settles it: a cold start warns once
 * per instance, an outage warns again every minute window.
 */
function logFailingOpen(
  err: unknown,
  kind: RateLimitKind,
  now: number,
  status: string | undefined,
): void {
  const windowIdx = currentWindowIndex(now);
  if (windowIdx === lastFailOpenLogWindow) {
    return;
  }
  lastFailOpenLogWindow = windowIdx;
  log.warn("rate_limit_redis_op_failed_failing_open", {
    error: err instanceof Error ? err.message : String(err),
    kind,
    status: status ?? "unknown",
  });
}

/**
 * Check (and increment) the per-principal counter of one lane.
 *
 * Result `.allowed` is true when the request is under the limit OR when
 * Redis is unavailable (fail-open). The caller uses `.allowed === false`
 * to short-circuit with HTTP 429; otherwise the request proceeds.
 */
export async function checkRateLimit(
  userId: string,
  kind: RateLimitKind,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const limit = LANES[kind].limit;
  const retryAfterSec = secondsUntilNextWindow(now);

  const redis = getClient();
  if (!redis) {
    return {
      allowed: true,
      count: 0,
      limit,
      retryAfterSec,
      redisOffline: true,
      kind,
    };
  }

  const windowIdx = currentWindowIndex(now);
  const key = keyFor(userId, kind, windowIdx);

  let count: number;
  try {
    count = await incrAndGet(key, redis);
  } catch (err) {
    // Any Redis-side error (a connection not ready yet, timeout, AUTH,
    // MOVED in a misconfigured cluster) → fail open, and say the count is
    // unknown. Warned at most once a minute per process (`logFailingOpen`).
    logFailingOpen(err, kind, now, redis.status);
    return {
      allowed: true,
      count: 0,
      limit,
      retryAfterSec,
      redisOffline: true,
      kind,
    };
  }

  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSec,
    redisOffline: false,
    kind,
  };
}

/* -------------------------------------------------------------------- */
/* Response helpers                                                     */
/* -------------------------------------------------------------------- */

/**
 * The budget a response reports for the lane its request drew on. With Redis
 * offline nothing was counted, so the remaining budget is the literal
 * `unknown` — never a number that would read as headroom.
 */
export function rateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "X-RateLimit-Lane": result.kind,
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": result.redisOffline
      ? "unknown"
      : String(Math.max(0, result.limit - result.count)),
    "X-RateLimit-Reset-After": String(result.retryAfterSec),
  };
}

/**
 * `response` carrying `rateLimitHeaders(result)`. Headers are set in place;
 * a response whose headers are immutable (a `fetch()` or `Response.redirect`
 * response) is rebuilt around the same body, status and headers instead.
 */
export function withRateLimitHeaders(
  response: Response,
  result: RateLimitResult,
): Response {
  const budget = Object.entries(rateLimitHeaders(result));
  try {
    for (const [name, value] of budget) {
      response.headers.set(name, value);
    }
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const [name, value] of budget) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function rateLimitedResponse(result: RateLimitResult): Response {
  const transport = isTransportLane(result.kind);
  return new Response(
    JSON.stringify({
      success: false,
      code: transport ? "TRANSPORT_RATE_LIMITED" : "RATE_LIMITED",
      lane: result.kind,
      message: transport
        ? `SDK transport rate limit exceeded on ${result.kind}; ` +
          `${result.count} requests in the current minute window, limit ` +
          `${result.limit} (sized for ${TRANSPORT_ENVELOPE_TABS} live tabs ` +
          `and ${TRANSPORT_ENVELOPE_DRIVERS} driving principals)`
        : `rate limit exceeded; ${result.count} requests in the current minute window`,
      retryAfterSec: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSec),
        ...rateLimitHeaders(result),
      },
    },
  );
}

/**
 * Log a refusal server-side, naming the lane and the kind of principal it
 * refused (`user`: an operator's bearer; `device`: a coord device JWT, keyed
 * `dev:<deviceId>`). The SDK discards a refused heartbeat's and result's
 * response, so this line is where a transport refusal is visible.
 *
 * Logged for the 1st, 2nd, 4th, 8th, … refusal of a principal's lane in a
 * window (`count - limit` a power of two). The SDK keeps its cadence through
 * 429s, so a principal over its envelope is refused steadily: every refusal
 * logged would cost one line per request for as long as it stays over. The
 * first refusal is always logged, and `count` still shows how far over it is.
 */
export function logLaneRefused(
  result: RateLimitResult,
  principalKind: "user" | "device" | null,
): void {
  const overflow = result.count - result.limit;
  if (overflow < 1 || (overflow & (overflow - 1)) !== 0) {
    return;
  }
  log.warn("lane_refused", {
    lane: result.kind,
    principalKind: principalKind ?? "unknown",
    count: result.count,
    limit: result.limit,
    retryAfterSec: result.retryAfterSec,
  });
}

/**
 * Map an HTTP method to the rate-limit kind (read vs write). GET and
 * HEAD are reads; everything else is a write. `door-proxy.ts` bills its
 * runner-door calls this way; the relay uses `laneFor`.
 */
export function kindForMethod(method: string): "read" | "write" {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

/**
 * The lane a relay request draws on, from its path and method alone: an SDK
 * transport route (`_transport.ts`) bills its own sub-lane, anything else the
 * command lane its method names.
 */
export function laneFor(path: string, method: string): RateLimitKind {
  const transport = sdkTransportLane(path, method);
  return transport === null ? kindForMethod(method) : `transport:${transport}`;
}
