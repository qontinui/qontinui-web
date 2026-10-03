"use client";

import { useEffect, useRef } from "react";

/**
 * Warn before the page is left with unsaved work, by every route a reader
 * leaves by:
 *
 * - close/reload — the browser's own prompt (it writes its own words);
 * - an in-app link — a confirm, since the App Router never unloads the page
 *   and so the browser does not prompt;
 * - the browser's back button — a `popstate` cannot be cancelled, so while
 *   any guard is armed the page sits one history entry deep (a copy of the
 *   current entry, marked as ours). Back lands on the page's own entry, the
 *   same URL, so nothing visible moves; the confirm then either restores the
 *   guard entry (stay) or finishes the trip (leave). A guard entry left behind
 *   once nothing is unsaved is skipped the same way, so it never costs the
 *   reader a dead press of Back.
 *
 * Out of reach: a jump of several entries at once (a long-press on Back)
 * lands on another URL before anything can ask, so it is not stopped. Work
 * that must survive that is kept on the device (`drafts.ts`).
 *
 * Every mounted guard on a page shares one listener set and one history
 * entry, so two editors open at once ask once, in the words of the first
 * that is armed. `message` is what the in-app confirm says.
 */
export function useLeaveGuard(active: boolean, message: string) {
  const guard = useRef<Guard>({ active, message });

  useEffect(() => {
    const entry = guard.current;
    mount(entry);
    return () => unmount(entry);
  }, []);

  useEffect(() => {
    guard.current.active = active;
    guard.current.message = message;
    if (active) armHistory();
  }, [active, message]);
}

interface Guard {
  active: boolean;
  message: string;
}

/** Marks the history entry this module pushed. */
const GUARD_MARK = "__overviewLeaveGuard";

const guards = new Set<Guard>();
/** The URL the current history entry guards, while the current entry is a
 *  guard entry; null otherwise. */
let guardedHref: string | null = null;

const armed = (): Guard | undefined =>
  [...guards].find((guard) => guard.active);

const isGuardState = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as Record<string, unknown>)[GUARD_MARK] === true;

function pushGuardEntry() {
  // A copy of the current entry's state, so the router restoring it on a
  // later traversal finds everything it put there.
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.pushState(
    { ...state, [GUARD_MARK]: true },
    "",
    window.location.href
  );
  guardedHref = window.location.href;
}

/** Make sure a guard entry is on top while something is armed. */
function armHistory() {
  if (guardedHref !== null) return;
  if (isGuardState(window.history.state)) {
    // Already there — this page was reached by traversing onto one.
    guardedHref = window.location.href;
    return;
  }
  pushGuardEntry();
}

function onPopState(event: PopStateEvent) {
  if (isGuardState(event.state)) {
    // Forward onto a guard entry: it guards again.
    guardedHref = window.location.href;
    return;
  }
  if (guardedHref === null) return;
  const left = guardedHref;
  guardedHref = null;
  // Several entries at once: already somewhere else, nothing to stop.
  if (window.location.href !== left) return;
  const guard = armed();
  if (guard && !window.confirm(guard.message)) {
    pushGuardEntry();
    return;
  }
  // Finish the trip Back started (also how a spent guard entry is skipped).
  window.history.back();
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!armed()) return;
  event.preventDefault();
  event.returnValue = "";
}

function onClick(event: MouseEvent) {
  const guard = armed();
  if (!guard) return;
  // A modified or non-primary click opens another tab: this page stays.
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!anchor || (anchor as HTMLAnchorElement).target === "_blank") return;
  if (!window.confirm(guard.message)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function mount(guard: Guard) {
  if (guards.size === 0) {
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onClick, true);
    // Arrived on a guard entry (Back from the next page, or a reload): Back
    // from here should skip it rather than land on the same page.
    if (isGuardState(window.history.state)) guardedHref = window.location.href;
  }
  guards.add(guard);
}

function unmount(guard: Guard) {
  guards.delete(guard);
  if (guards.size > 0) return;
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("popstate", onPopState);
  document.removeEventListener("click", onClick, true);
  guardedHref = null;
}
