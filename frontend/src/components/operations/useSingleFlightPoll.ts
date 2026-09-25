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
export type SingleFlightPollFn = (isCurrent: () => boolean) => Promise<void>;

export interface UseSingleFlightPollResult {
  /**
   * Poll now. Starts a request when none is outstanding; otherwise schedules
   * one trailing request after the outstanding one (coalesced). Resolves when
   * the request that will reflect this call has finished.
   */
  refresh: () => Promise<void>;
}

export function useSingleFlightPoll(
  poll: SingleFlightPollFn,
  intervalMs: number
): UseSingleFlightPollResult {
  const pollRef = useRef(poll);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const trailingRef = useRef<Promise<void> | null>(null);
  // Bumped on every setup AND teardown, so a flight started under one setup
  // can tell that it no longer speaks for the component.
  const generationRef = useRef(0);
  // False between unmount and never: a trailing run queued by the last
  // flight must not go out after the component is gone.
  const activeRef = useRef(false);

  const start = useCallback((): Promise<void> => {
    if (!activeRef.current) return Promise.resolve();
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    const flight = (async () => {
      try {
        await pollRef.current(isCurrent);
      } catch (err) {
        console.error("[useSingleFlightPoll] poll rejected", err);
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = flight;
    return flight;
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const current = inFlightRef.current;
    if (current === null) return start();
    if (trailingRef.current === null) {
      trailingRef.current = current.then(() => {
        trailingRef.current = null;
        // `flight`'s `finally` has already cleared the latch by the time this
        // runs (it settles before `current` resolves), and no timer can fire
        // between the two, so this normally starts a fresh request. The
        // fallback keeps the one-in-flight guarantee if that ever changes.
        return inFlightRef.current ?? start();
      });
    }
    return trailingRef.current;
  }, [start]);

  const tick = useCallback(() => {
    // Skipped, not queued: an outstanding request means this tick's question
    // is already being asked.
    if (inFlightRef.current !== null) return;
    void start();
  }, [start]);

  useEffect(() => {
    pollRef.current = poll;
    generationRef.current += 1;
    activeRef.current = true;
    // Through `refresh`, not `start`: if a flight from the previous setup is
    // still outstanding, this setup's first read queues behind it instead of
    // running beside it.
    void refresh();
    const id = setInterval(tick, intervalMs);
    return () => {
      generationRef.current += 1;
      activeRef.current = false;
      clearInterval(id);
    };
  }, [poll, intervalMs, refresh, tick]);

  return { refresh };
}
