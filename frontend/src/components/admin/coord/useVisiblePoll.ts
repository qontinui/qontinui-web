"use client";

/**
 * Poll `fn` on `intervalMs`, SKIPPING ticks while the tab is hidden and
 * catching up the moment it becomes visible again.
 *
 * The initial fetch is the CALLER's job and always runs, so a tab that mounts
 * hidden still has data when it is revealed. This hook owns only the repeat.
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
 * Related surfaces that gate their own polling and deliberately do NOT import
 * this: `/admin/coord/alerts` (`page.tsx` `usePoll`, which additionally
 * suspends while the operator has paged past screen one) and `RedMainBanner`
 * (whose gate is entangled with its empty-poll streak counter). Both have
 * behaviour this hook does not model; unifying them would mean pushing their
 * specifics in here, which is the wrong direction.
 */

import { useEffect } from "react";

export function useVisiblePoll(fn: () => void, intervalMs: number) {
  useEffect(() => {
    // An effect never runs during SSR, so `document` is in practice always
    // here; the guard is for a non-DOM test environment, and it defaults to
    // VISIBLE so a missing `document` can never silently stop the polling this
    // hook exists to do.
    const visible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const tick = () => {
      if (visible()) fn();
    };
    const onVisibilityChange = () => {
      if (visible()) fn();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fn, intervalMs]);
}
