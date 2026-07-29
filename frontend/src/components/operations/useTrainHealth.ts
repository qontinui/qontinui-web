"use client";

// ============================================================================
// useTrainHealth — merge-train liveness for the pipeline's "Train" tab.
// ============================================================================
//
// A deliberately separate hook from `useMergePipelineData` rather than a sixth
// call inside its batch, for two reasons:
//
//   1. Only the Train tab needs it. Folding it into the shared batch would add
//      a request to EVERY dashboard poll on every tab, which is exactly the
//      load the 2026-07-21 prod incident was caused by — the operations proxy
//      pins a backend DB connection for the whole outbound coord round-trip,
//      so request volume is connection-pool cost, one-for-one.
//   2. coord's `assemble_health` resolves effective settings per ready-unmerged
//      PR, so its cost scales with the ready backlog — the exact condition
//      under which an operator is staring at this tab. It gets its own slower
//      cadence instead of riding the hot poll.
//
// It therefore follows the same three load rules as the shared hook:
// single-flight, gap measured from COMPLETION, and no polling while the
// document is hidden.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import type { TrainHealth } from "./mergeTypes";

const log = createLogger("useTrainHealth");

/**
 * Poll cadence. The signals here move at merge-train cadence (a land, a lease
 * heartbeat, a rollout flip) — none of which is sub-minute — so 20s surfaces a
 * change within a couple of coord reconcile ticks without adding meaningful
 * pool pressure.
 */
export const TRAIN_HEALTH_POLL_MS = 20_000;

export interface TrainHealthState {
  /** `null` until the first fetch resolves. */
  health: TrainHealth | null;
  /** True once a fetch has completed, successfully or not. */
  loaded: boolean;
}

/**
 * Fetch `GET /api/v1/operations/pr-merge/health` while `enabled`.
 *
 * Degradation contract: the web proxy already turns a 404 (coord deploy
 * predating the route) or a transient coord outage into `{}`, and this hook
 * treats any other failure the same way — it keeps the last known-good body
 * rather than blanking. An empty object is a legitimate, renderable state: the
 * Train tab drops its fleet banner and derives everything else from the queue
 * and PR list. It never surfaces an error string, because the tab is still
 * useful without it.
 */
export function useTrainHealth(enabled: boolean): TrainHealthState {
  const [health, setHealth] = useState<TrainHealth | null>(null);
  const [loaded, setLoaded] = useState(false);

  const cleanedUpRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Epoch ms of the last fetch START — throttles the visibility-reveal path. */
  const lastFetchAtRef = useRef(0);

  const fetchHealth = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    lastFetchAtRef.current = Date.now();
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/pr-merge/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as TrainHealth;
      if (!cleanedUpRef.current) {
        setHealth(body ?? {});
        setLoaded(true);
      }
    } catch (err) {
      log.warn("fetchHealth failed — keeping last known health", err);
      if (!cleanedUpRef.current) {
        // `{}` (not null) so consumers move out of the loading state and
        // render the degraded view rather than a permanent skeleton.
        setHealth((prev) => prev ?? {});
        setLoaded(true);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    // AFTER the `enabled` check, not before: the disabled path registers no
    // cleanup, so resetting the guard there re-opened it permanently. Switching
    // off the Train tab ran the old cleanup (setting it true) and then
    // immediately re-ran this effect setting it back to false with nothing to
    // close it again — so a fetch still in flight resolved with the guard open
    // and wrote state into an unmounting tree.
    if (!enabled) return;
    cleanedUpRef.current = false;

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    // Gap measured from completion, so a slow backend stretches the cadence
    // instead of piling requests onto it.
    const schedule = () => {
      clear();
      timerRef.current = setTimeout(async () => {
        if (cleanedUpRef.current) return;
        if (typeof document === "undefined" || !document.hidden) {
          await fetchHealth();
        }
        if (!cleanedUpRef.current) schedule();
      }, TRAIN_HEALTH_POLL_MS);
    };

    // Gated like the poll: opening the Train tab in a background window must
    // not issue a request nobody is looking at.
    if (typeof document === "undefined" || !document.hidden) void fetchHealth();
    schedule();

    // A tab revealed after a long hide holds stale data; refresh on reveal
    // rather than waiting out the remaining interval — but THROTTLED, not on
    // every reveal. Rapid hide/reveal churn (alt-tab, a monitor sleeping,
    // window-manager events) would otherwise issue one proxy request per
    // reveal, each pinning a backend DB session for its whole coord round-trip.
    // The sibling hook throttles its equivalent for exactly this reason.
    const onVisibility = () => {
      if (document.hidden || cleanedUpRef.current) return;
      const since = Date.now() - lastFetchAtRef.current;
      if (since >= TRAIN_HEALTH_POLL_MS) {
        void fetchHealth();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cleanedUpRef.current = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, fetchHealth]);

  return { health, loaded };
}
