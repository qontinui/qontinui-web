"use client";

/**
 * useCoPilotActivity — observe whether the AI co-pilot has issued a write
 * command "recently".
 *
 * # Why polling
 *
 * The SDK's ``CommandRelayListener`` (``@qontinui/ui-bridge/react``) does
 * NOT surface a per-command callback browser-side as of 0.13.0 — the
 * listener consumes the SSE stream + executes commands against the global
 * registry, returning nothing to React-land. Adding such a callback to the
 * SDK is its own coordinated change; for §4.5 the spec calls that
 * downstream wiring and prescribes polling as the fallback.
 *
 * Per the design priorities (powerful → scalable → robust → clean):
 * polling against the §4.8 audit-log endpoint is more ROBUST than scraping
 * SDK internals or hooking the relay route's response path — the audit
 * log is the canonical record of "did a co-pilot command happen for this
 * user". The 5s poll interval is well within the "30 seconds since last
 * action" banner-visibility window the spec defines and is cheap (one GET
 * with ``limit=1`` per tick; the endpoint is per-user scoped + cursor
 * paginated).
 *
 * The endpoint is the same one the §4.8 audit-log viewer page reads:
 * ``GET /api/v1/users/me/co-pilot/activity?limit=1``. Each row carries
 * ``occurred_at``; we treat the latest as the "last action" timestamp and
 * compute ``isActive = (now - latest) <= staleAfterMs``.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const ACTIVITY_URL = `${ApiConfig.API_BASE_URL}/api/v1/users/me/co-pilot/activity?limit=1`;

/** Default poll cadence — fast enough for a 30s "active" window. */
export const DEFAULT_CO_PILOT_POLL_INTERVAL_MS = 5_000;
/** Default activity-staleness threshold — matches the spec ("last 30s"). */
export const DEFAULT_CO_PILOT_STALE_AFTER_MS = 30_000;

interface ActivityRow {
  occurred_at: string;
}

interface ActivityResponse {
  items?: ActivityRow[];
}

export interface UseCoPilotActivityOptions {
  /**
   * Whether the hook should poll. Default true. Set false when the user
   * preference is off (no point hammering the endpoint) or when the
   * banner is unmounted.
   */
  enabled?: boolean;
  /** Override poll cadence (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Override staleness threshold (ms). Default 30000. */
  staleAfterMs?: number;
  /**
   * Optional clock — exposed for tests so we don't have to vi.useFakeTimers
   * on every assertion.
   */
  now?: () => number;
}

export interface UseCoPilotActivity {
  /** True when the latest command occurred within ``staleAfterMs``. */
  isActive: boolean;
  /**
   * Epoch ms of the latest known co-pilot command, or ``null`` if the
   * caller has none. Used by the banner's "last action 5s ago" text.
   */
  lastActionAt: number | null;
}

export function useCoPilotActivity(
  options: UseCoPilotActivityOptions = {}
): UseCoPilotActivity {
  const {
    enabled = true,
    pollIntervalMs = DEFAULT_CO_PILOT_POLL_INTERVAL_MS,
    staleAfterMs = DEFAULT_CO_PILOT_STALE_AFTER_MS,
    now: nowFn = () => Date.now(),
  } = options;

  const [lastActionAt, setLastActionAt] = useState<number | null>(null);
  // Tick state forces a re-evaluation of `isActive` every poll, so the
  // banner correctly disappears once the 30s window elapses even when no
  // new command arrives.
  const [, setTick] = useState(0);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    async function pollOnce() {
      // Abort any prior in-flight request so a slow response doesn't
      // overwrite a faster newer one.
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const res = await httpClient.fetch(ACTIVITY_URL, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as ActivityResponse;
        const first = data.items?.[0];
        if (!first || !first.occurred_at) {
          // No rows = nobody has driven this account; keep whatever the
          // banner already knew (don't clobber a recent action just
          // because the endpoint returned empty during a brief window).
          return;
        }
        const parsed = Date.parse(first.occurred_at);
        if (Number.isNaN(parsed)) return;
        if (cancelled) return;
        setLastActionAt((prev) =>
          prev === null || parsed > prev ? parsed : prev
        );
      } catch {
        // network error / abort — swallow; next tick retries
      }
    }

    // Kick off immediately so the banner reflects existing state quickly
    // (e.g. the user just opted in mid-session).
    void pollOnce();
    const interval = setInterval(() => {
      void pollOnce();
      // bump tick so isActive re-computes even without a new row
      setTick((t) => t + 1);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, [enabled, pollIntervalMs]);

  const isActive = useMemo(() => {
    if (lastActionAt === null) return false;
    return nowFn() - lastActionAt <= staleAfterMs;
    // nowFn is intentionally not in deps — it's a clock, not state.
    // We re-evaluate on every render and the tick state bumps re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastActionAt, staleAfterMs]);

  return { isActive, lastActionAt };
}
