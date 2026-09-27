"use client";

/**
 * Poll `fn` on `intervalMs`, SKIPPING ticks while the tab is hidden and
 * catching up the moment it becomes visible again.
 *
 * The initial fetch is the CALLER's job by default, so a tab that mounts
 * hidden still has data when it is revealed. Pass `{ runOnMount: true }` to
 * have this hook make it instead, under the same in-flight guard as every
 * later call (the fleet alarm badge does).
 *
 * ## Single-flight
 *
 * When `fn` returns a promise, nothing else is started until it settles: a
 * tick or a reveal that lands while a read is outstanding is SKIPPED, not
 * queued (plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`
 * D5). Without it a read slower than the interval stacked a second read on
 * top of the first on every tick, against a coord that was already slow. A
 * caller that wants the guard must RETURN its promise — `() => void p()`
 * opts out. A reveal skipped this way is not lost: the outstanding read is
 * already answering the same question.
 *
 * ## Why this is a module rather than a local helper
 *
 * The console nav renders on EVERY `/admin/coord/*` page, so its badges are
 * the widest-reach pollers in the app. Left ungated, a tab left open overnight
 * bills a request per badge per minute against rollups nobody is looking at.
 *
 * It started as a local helper inside `CoordNav.tsx` covering that file's two
 * badges. `useFleetAlarmBadge` then arrived as a THIRD nav poller in its own
 * module, and a local helper could not reach it — `CoordNav` imports the badge
 * hook, so importing the helper back out of `CoordNav` would close a cycle.
 * The gate living where only one of three callers can see it is what let the
 * third one ship ungated, so it lives here now: a nav poller that cannot import
 * the gate is a nav poller that will not use it.
 *
 * A related surface that gates its own polling and deliberately does NOT
 * import this: `RedMainBanner`, whose gate is entangled with its empty-poll
 * streak counter. It has behaviour this hook does not model; unifying it would
 * mean pushing its specifics in here, which is the wrong direction.
 */

import { useEffect, useRef } from "react";

export function useVisiblePoll(
  fn: () => void | Promise<unknown>,
  intervalMs: number,
  options: { runOnMount?: boolean } = {}
) {
  const runOnMount = options.runOnMount ?? false;
  // Per hook instance, and deliberately NOT reset when the effect re-runs: a
  // read started under the previous `fn` is still on the wire.
  const inFlight = useRef(false);
  useEffect(() => {
    // An effect never runs during SSR, so `document` is in practice always
    // here; the guard is for a non-DOM test environment, and it defaults to
    // VISIBLE so a missing `document` can never silently stop the polling this
    // hook exists to do.
    const visible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const run = () => {
      if (inFlight.current) return;
      let result: void | Promise<unknown>;
      try {
        result = fn();
      } catch (err) {
        console.error("[useVisiblePoll] poll threw", err);
        return;
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        inFlight.current = true;
        const release = () => {
          inFlight.current = false;
        };
        (result as Promise<unknown>).then(release, release);
      }
    };
    const tick = () => {
      if (visible()) run();
    };
    const onVisibilityChange = () => {
      if (visible()) run();
    };
    if (runOnMount) run();
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fn, intervalMs, runOnMount]);
}
