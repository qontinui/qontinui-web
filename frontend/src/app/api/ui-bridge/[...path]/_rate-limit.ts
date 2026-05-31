/**
 * Per-user, per-minute rate limit for the UI Bridge relay (§4.8 of the
 * production-safe plan).
 *
 * Two counters per user — reads (GET) and writes (POST/PUT/DELETE) —
 * keyed on the current minute window. Backed by the same Upstash Redis
 * the relay's `UI_BRIDGE_RELAY_REDIS_URL` already uses (one Redis bus,
 * one envelope of trust). When that env var is unset OR Redis is
 * unreachable, the gate fails OPEN — see "Failure mode" below.
 *
 * The window is per-user, NEVER per-tab. A user with 5 tabs gets one
 * budget, not 5× the budget. This matches the threat model: the limit
 * exists to defang command-flooding (§4.8 threat row), and a flooder
 * with N tabs is the same threat scaled.
 *
 * Limits (from the plan §4.8):
 *   - Reads:  60/minute per user
 *   - Writes: 20/minute per user
 *
 * Window: clock-aligned minute. Counter key embeds the minute index so a
 * user can't carry budget across a window boundary, and the keys
 * naturally expire (we set EXPIRE 70s on each INCR — slightly larger
 * than the window so a final INCR near the boundary doesn't lose its
 * TTL).
 *
 * # Failure mode (CRITICAL)
 *
 * The relay's core function is AUTHENTICATION, not rate limiting. If
 * Redis is unreachable (`UI_BRIDGE_RELAY_REDIS_URL` unset, network
 * error, AUTH error), this module returns `{ok: true, allowed: true,
 * redisOffline: true}` — fail OPEN. Failing closed would tear down the
 * bridge for every user the moment Redis hiccups, which is much worse
 * than briefly disabling rate limits.
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

const log = createLogger("UIBridgeRateLimit");

/* -------------------------------------------------------------------- */
/* Limits + window                                                      */
/* -------------------------------------------------------------------- */

export const READ_LIMIT_PER_MIN = 60;
export const WRITE_LIMIT_PER_MIN = 20;
const WINDOW_MS = 60_000;
/** TTL on each minute-window counter key (slightly > the window). */
const COUNTER_TTL_SEC = 70;

export type RateLimitKind = "read" | "write";

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
}

function currentWindowIndex(now: number = Date.now()): number {
  return Math.floor(now / WINDOW_MS);
}

function secondsUntilNextWindow(now: number = Date.now()): number {
  const windowEnd = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
  return Math.max(1, Math.ceil((windowEnd - now) / 1000));
}

function keyFor(userId: string, kind: RateLimitKind, windowIdx: number): string {
  // `r` for reads, `w` for writes — short keys keep the Redis bill predictable.
  const prefix = kind === "read" ? "r" : "w";
  return `bridge:rl:${prefix}:${userId}:${windowIdx}`;
}

/**
 * Atomically INCR the per-(user, kind, window) counter. On the first
 * INCR of a window the EXPIRE is set so the key self-cleans.
 *
 * Pipeline gives us both ops in one RTT; the INCR result is what we
 * compare against the limit. The EXPIRE return is fire-and-forget
 * (success/failure doesn't gate the request).
 */
async function incrAndGet(key: string, redis: Redis): Promise<number> {
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, COUNTER_TTL_SEC);
  const results = await pipeline.exec();
  if (!results || results.length === 0) return 0;
  const incrResult = results[0];
  if (!incrResult || incrResult[0]) return 0; // [err, value]
  return Number(incrResult[1] ?? 0);
}

/**
 * Check (and increment) the per-user, per-kind rate counter.
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
  const limit = kind === "read" ? READ_LIMIT_PER_MIN : WRITE_LIMIT_PER_MIN;
  const retryAfterSec = secondsUntilNextWindow(now);

  const redis = getClient();
  if (!redis) {
    return {
      allowed: true,
      count: 0,
      limit,
      retryAfterSec,
      redisOffline: true,
    };
  }

  const windowIdx = currentWindowIndex(now);
  const key = keyFor(userId, kind, windowIdx);

  let count: number;
  try {
    count = await incrAndGet(key, redis);
  } catch (err) {
    // Any Redis-side error (timeout, AUTH, MOVED in a misconfigured
    // cluster) → fail open. Logged once at warn so an operator can spot
    // a persistent outage; flood-suppressed by ioredis's own backoff.
    log.warn("rate_limit_redis_op_failed_failing_open", {
      error: err instanceof Error ? err.message : String(err),
      kind,
    });
    return {
      allowed: true,
      count: 0,
      limit,
      retryAfterSec,
      redisOffline: true,
    };
  }

  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSec,
    redisOffline: false,
  };
}

/* -------------------------------------------------------------------- */
/* Response helper                                                      */
/* -------------------------------------------------------------------- */

export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "RATE_LIMITED",
      message: `rate limit exceeded; ${result.count} requests in the current minute window`,
      retryAfterSec: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSec),
      },
    },
  );
}

/**
 * Map an HTTP method to the rate-limit kind (read vs write). GET and
 * HEAD are reads; everything else is a write.
 */
export function kindForMethod(method: string): RateLimitKind {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}
