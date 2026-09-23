"use client";

/**
 * Runner locality — is this runner on the machine the BROWSER is on?
 *
 * The web runner list is fleet-wide (every runner the user has paired, on any
 * machine), but a loopback base URL only reaches the box the browser runs on.
 * Keeping a remote runner's port and pointing it at `127.0.0.1` either
 * connect-refuses or — worse — silently talks to whatever LOCAL process owns
 * that port (plan 2026-09-20-runner-selector-drives-a-transport-not-a-target).
 *
 * The proof of locality is IDENTITY, not port liveness: the runner's loopback
 * `GET /settings/device-info` returns its coord `device_id`, which is exactly
 * the web list's `runner.id` (plan Phase 0, A0.1). A port that answers with a
 * different id is the collision case, and is `not_local`.
 *
 * Three states, and `unknown` is never collapsed into `local`:
 *   - `local`     — 127.0.0.1:<port> answered with this runner's id.
 *   - `not_local` — it answered with a DIFFERENT id. Only an identity answer
 *                   can support the claim "this runner is on another
 *                   machine".
 *   - `unknown`   — no port, this page's origin cannot reach loopback at all,
 *                   the connection failed, the probe timed out, or the answer
 *                   was not a readable identity (non-2xx, unparseable, no
 *                   `device_id`).
 */

import { useEffect, useMemo, useState } from "react";
import type { Runner } from "@qontinui/shared-types";
import { isRunnerReachable } from "./origin";

export type RunnerLocality = "local" | "not_local" | "unknown";

/** The fields of a runner the locality probe reads. */
export type RunnerLocalityTarget = Pick<Runner, "id" | "port">;

/** Probe budget. The route is a cheap in-process read on a loopback socket. */
export const LOCALITY_PROBE_TIMEOUT_MS = 1500;

/** How long a measured locality is reused before it is probed again. */
export const LOCALITY_TTL_MS = 30_000;

/** Backoff before the one retry of an inconclusive re-probe of a proven-local runner. */
export const LOCAL_RECHECK_BACKOFF_MS = 1000;

/** The runner's default port — used only when the runner list is loaded and empty. */
export const DEFAULT_RUNNER_PORT = 9876;

/** The loopback base URL of a runner port. Spelled 127.0.0.1: the runner binds IPv4 only. */
export function loopbackBaseForPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Probe once, uncached. Prefer {@link measureRunnerLocality}, which shares
 * one probe per (runner.id, port) across every caller.
 */
export async function isRunnerLocal(
  runner: RunnerLocalityTarget,
  timeoutMs: number = LOCALITY_PROBE_TIMEOUT_MS
): Promise<RunnerLocality> {
  if (runner.port == null) return "unknown";
  if (!isRunnerReachable()) return "unknown";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(
      `${loopbackBaseForPort(runner.port)}/settings/device-info`,
      { signal: controller.signal }
    );
  } catch {
    clearTimeout(timeoutId);
    // A failed connect is `unknown`, not `not_local`. The browser reports a
    // refused connection and a CORS / origin-guard / network block as the
    // same opaque TypeError, so it cannot distinguish "nothing listens here"
    // from "this machine's own runner refused this page" — and the UI would
    // then assert "on another machine" about a runner that is on this one.
    // The transport is identical either way (no loopback base), so only the
    // label is at stake, and the label must not claim what was not measured.
    return "unknown";
  }

  try {
    if (!response.ok) return "unknown";
    const json: unknown = JSON.parse(await response.text());
    const deviceId = readDeviceId(json);
    if (deviceId === null) return "unknown";
    return deviceId.toLowerCase() === runner.id.toLowerCase()
      ? "local"
      : "not_local";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeoutId);
  }
}

/** `{ success, data: { device_id } }` (the runner's ApiResponse envelope) → device_id. */
function readDeviceId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const deviceId = (data as { device_id?: unknown }).device_id;
  return typeof deviceId === "string" && deviceId.length > 0 ? deviceId : null;
}

// =============================================================================
// Shared cache — one measurement per (runner.id, port)
// =============================================================================

interface LocalityCacheEntry {
  result: RunnerLocality | null;
  measuredAt: number;
  pending: Promise<RunnerLocality> | null;
}

const _cache = new Map<string, LocalityCacheEntry>();

function cacheKey(runner: RunnerLocalityTarget): string {
  return `${runner.id}:${runner.port ?? ""}`;
}

/** The cached measurement, if one is still within its TTL. */
export function peekRunnerLocality(
  runner: RunnerLocalityTarget
): RunnerLocality | undefined {
  const entry = _cache.get(cacheKey(runner));
  if (!entry || entry.result === null) return undefined;
  if (Date.now() - entry.measuredAt >= LOCALITY_TTL_MS) return undefined;
  return entry.result;
}

/**
 * The last measurement for this exact (runner.id, port), however old. Used
 * only to keep a known answer on screen while its re-probe is in flight.
 */
function lastRunnerLocality(
  runner: RunnerLocalityTarget
): RunnerLocality | undefined {
  return _cache.get(cacheKey(runner))?.result ?? undefined;
}

/**
 * Measure a runner's locality, reusing a fresh result or an in-flight probe.
 * `force` skips the fresh-result reuse (an in-flight probe is still shared) —
 * the periodic re-probe uses it so its cadence is the interval, not up to
 * twice the TTL.
 */
export function measureRunnerLocality(
  runner: RunnerLocalityTarget,
  options?: { force?: boolean }
): Promise<RunnerLocality> {
  const key = cacheKey(runner);
  if (!options?.force) {
    const cached = peekRunnerLocality(runner);
    if (cached !== undefined) return Promise.resolve(cached);
  }

  const existing = _cache.get(key);
  if (existing?.pending) return existing.pending;

  const entry: LocalityCacheEntry = existing ?? {
    result: null,
    measuredAt: 0,
    pending: null,
  };
  entry.pending = isRunnerLocal(runner).then(async (first) => {
    let result = first;
    // A runner whose identity was already PROVEN local on this exact
    // (id, port) and whose re-probe is merely inconclusive (a slow answer, a
    // transient failure) gets ONE retry after a short backoff before the
    // demotion is published; until then the earlier `local` stays in the
    // cache and on screen. This is a deliberately bounded trust in an
    // earlier identity proof — one retry, about LOCALITY_PROBE_TIMEOUT_MS
    // plus LOCAL_RECHECK_BACKOFF_MS — not `unknown` treated as `local`: a
    // second inconclusive answer is published as `unknown`, and a definite
    // different id is published as `not_local` at once.
    if (first === "unknown" && entry.result === "local") {
      await new Promise((resolve) =>
        setTimeout(resolve, LOCAL_RECHECK_BACKOFF_MS)
      );
      result = await isRunnerLocal(runner);
    }
    entry.result = result;
    entry.measuredAt = Date.now();
    entry.pending = null;
    return result;
  });
  _cache.set(key, entry);
  return entry.pending;
}

/** Test seam: forget every measurement. */
export function __resetRunnerLocalityCache(): void {
  _cache.clear();
}

// =============================================================================
// React hook
// =============================================================================

/**
 * Measured locality of each runner, keyed by `runner.id`. A runner absent from
 * the map has not been measured yet — render it as unknown, never as local.
 * Re-probes every {@link LOCALITY_TTL_MS} so a runner started (or stopped) on
 * this box after page load is picked up.
 */
export function useRunnerLocality(
  runners: readonly RunnerLocalityTarget[]
): ReadonlyMap<string, RunnerLocality> {
  // The runner list is re-pushed on every heartbeat; only (id, port) matters.
  const targetsKey = runners.map(cacheKey).join("|");
  const targets = useMemo(
    () => runners.map((r) => ({ id: r.id, port: r.port })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on (id, port) only
    [targetsKey]
  );

  const [localities, setLocalities] = useState<Map<string, RunnerLocality>>(
    () => {
      const initial = new Map<string, RunnerLocality>();
      for (const t of targets) {
        const cached = peekRunnerLocality(t);
        if (cached !== undefined) initial.set(t.id, cached);
      }
      return initial;
    }
  );

  useEffect(() => {
    let cancelled = false;

    const measureAll = (force: boolean) => {
      for (const target of targets) {
        void measureRunnerLocality(target, { force }).then((result) => {
          if (cancelled) return;
          setLocalities((prev) => {
            if (prev.get(target.id) === result) return prev;
            const next = new Map(prev);
            next.set(target.id, result);
            return next;
          });
        });
      }
    };

    // Drop measurements for runners no longer listed, and for runners whose
    // port moved — a new port is a new (id, port) key and is measured afresh.
    setLocalities((prev) => {
      const next = new Map<string, RunnerLocality>();
      for (const t of targets) {
        const known = lastRunnerLocality(t);
        if (known !== undefined) next.set(t.id, known);
      }
      const unchanged =
        next.size === prev.size &&
        [...next].every(([id, value]) => prev.get(id) === value);
      return unchanged ? prev : next;
    });

    measureAll(false);
    const intervalId = setInterval(() => measureAll(true), LOCALITY_TTL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [targets]);

  return localities;
}
