"use client";

/**
 * Single-flight interval polling for the Dev Ops dashboard's reads (plan
 * `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`, D5).
 *
 * ## Why this exists
 *
 * A bare `setInterval(refresh, N)` fires whether or not the previous request
 * finished. Against a coord read that takes longer than the interval (the
 * `/fleet/volumes` 504s of 2026-09-22 took 5-11 s against a 5 s poll), every
 * tick stacks another request on top of the ones still outstanding, so one
 * viewer's load on coord grows with coord's own slowness. That is the
 * multiplier D5 removes.
 *
 * ## The contract
 *
 * - **At most one request in flight per hook instance** (per route, per tab).
 * - **An interval tick that finds a request outstanding is SKIPPED, not
 *   queued.** The next tick after it finishes polls as normal.
 * - **An explicit `refresh()` while one is outstanding coalesces into ONE
 *   trailing run** after it, rather than being dropped. A caller refreshing
 *   after a write (a drain, say) needs a read that STARTED after the write; a
 *   poll that was already in flight may have been answered from before it.
 *   Any number of such calls during one flight produce one trailing run.
 * - **A result from a superseded setup is discarded.** When `poll` changes
 *   (its parameters changed) or the component unmounts, `isCurrent()` turns
 *   false for the flight already under way, and the setup that replaced it
 *   schedules its own run behind it.
 *
 * `poll` owns its own error handling (it sets its hook's `error` state). A
 * rejection that escapes it anyway is logged here, never rethrown into a timer
 * callback, and never leaves the single-flight latch stuck.
 */

import { useCallback, useEffect, useRef } from "react";

/**
 * One poll. `isCurrent()` is false once the setup that started this flight
 * has been torn down; a poll must check it before writing state.
 */
export type SingleFlightPollFn = (isCurrent: () => boolean) => Promise<unknown>;

export interface UseSingleFlightResult {
  /**
   * Run now. Starts a request when none is outstanding; otherwise schedules
   * one trailing request after the outstanding one (coalesced). Resolves when
   * the request that will reflect this call has finished.
   */
  refresh: () => Promise<void>;
  /**
   * Run now ONLY if nothing is outstanding. What an interval tick calls: an
   * outstanding request means this tick's question is already being asked,
   * so the tick is skipped, not queued.
   */
  tick: () => void;
}

export type UseSingleFlightPollResult = Pick<UseSingleFlightResult, "refresh">;

/**
 * The single-flight latch on its own, for hooks that drive their own timers
 * (the WebSocket-with-polling-fallback streams, whose interval starts and
 * stops with the socket and with tab visibility). Route EVERY call of `fn`
 * through the returned `tick` (timers) or `refresh` (everything else), or the
 * latch guards nothing.
 *
 * `fn`'s `isCurrent()` turns false when `fn` changes or the component
 * unmounts; nothing is started after unmount. See `activeRef` for the one
 * ordering rule a caller must follow.
 *
 * ## Why this is not `useGuardedPoll`
 *
 * `components/admin/coord/useGuardedPoll.ts` is the other polling primitive,
 * and both exist on purpose (decided by capability first):
 *
 * - `useGuardedPoll` lets an operator's refresh CLICK run beside an
 *   outstanding tick, and orders the answers with two generations (per
 *   question, per request), so an overtaken FAILURE can still speak for the
 *   question on screen. That is the list pages' capability: a paging or
 *   filter change must answer at once, not after a slow read.
 * - This hook never has two requests on the wire: a refresh during a flight
 *   TRAILS it, once. That is the dashboard polls' capability: a bounded
 *   per-viewer load on coord however slow coord gets (D5), which
 *   `useGuardedPoll`'s overlapping refresh cannot give.
 *
 * Folding one into the other would remove one of the two capabilities.
 */
export function useSingleFlight(fn: SingleFlightPollFn): UseSingleFlightResult {
  const fnRef = useRef(fn);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const trailingRef = useRef<Promise<void> | null>(null);
  // Bumped on every setup AND teardown, so a flight started under one setup
  // can tell that it no longer speaks for the component.
  const generationRef = useRef(0);
  /**
   * True from this hook's own mount effect until its cleanup. A trailing run
   * queued by the last flight must not go out after the component is gone.
   *
   * ⚠️ ORDERING: it starts `false` and is set by an EFFECT, so a caller must
   * call `useSingleFlight` BEFORE declaring any effect that calls `refresh` /
   * `tick` on mount. React runs a component's effects in declaration order;
   * an earlier-declared effect's call would find `activeRef` still false and
   * be dropped silently — on first mount and again on every StrictMode
   * re-mount. `useSingleFlightPoll` satisfies this by construction.
   */
  const activeRef = useRef(false);

  const start = useCallback((): Promise<void> => {
    if (!activeRef.current) return Promise.resolve();
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    // The latch is set BEFORE `fn` runs: `fn` is invoked from a microtask, so
    // even one that throws synchronously cannot settle this flight before it
    // is recorded (which would leave a settled promise in the latch and skip
    // every later tick forever).
    const flight: Promise<void> = Promise.resolve()
      // Superseded (unmount or a new `fn`) before the microtask ran: send
      // nothing — its answer would be discarded anyway.
      .then(async () => {
        if (isCurrent()) await fnRef.current(isCurrent);
      })
      .catch((err: unknown) => {
        console.error("[useSingleFlight] poll rejected", err);
      })
      .finally(() => {
        // Clear only our own latch: never one a later flight has taken.
        if (inFlightRef.current === flight) inFlightRef.current = null;
      });
    inFlightRef.current = flight;
    return flight;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const current = inFlightRef.current;
    if (current === null) return start();
    if (trailingRef.current === null) {
      trailingRef.current = current.then(() => {
        trailingRef.current = null;
        // `current`'s `finally` has cleared the latch by the time this runs,
        // and no timer can fire between the two, so this normally starts a
        // fresh request. The fallback keeps the one-in-flight guarantee if
        // that ever changes.
        return inFlightRef.current ?? start();
      });
    }
    return trailingRef.current;
  }, [start]);

  const tick = useCallback(() => {
    if (inFlightRef.current !== null) return;
    void start();
  }, [start]);

  useEffect(() => {
    fnRef.current = fn;
    generationRef.current += 1;
    activeRef.current = true;
    return () => {
      generationRef.current += 1;
      activeRef.current = false;
    };
  }, [fn]);

  return { refresh, tick };
}

/** {@link useSingleFlight} plus the interval that drives it. */
export function useSingleFlightPoll(
  poll: SingleFlightPollFn,
  intervalMs: number
): UseSingleFlightPollResult {
  const { refresh, tick } = useSingleFlight(poll);

  useEffect(() => {
    // Through `refresh`, not `tick`: if a flight from the previous `poll` is
    // still outstanding, this setup's first read queues behind it instead of
    // running beside it. `poll` is a dependency so new parameters are read
    // at once.
    void refresh();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [poll, intervalMs, refresh, tick]);

  return { refresh };
}
