/**
 * presentationClock — one shared tick that keeps every "as of 3m ago" current.
 *
 * A provenance chip states the AGE of a number, and an age that stops
 * advancing is a false claim: an evaluator reading "as of 12s ago" on a figure
 * that is ten minutes old is being shown exactly the staged freshness the
 * presentation lens exists to avoid. So chips re-render on a tick. ONE
 * interval serves every subscriber; it starts with the first and stops with
 * the last, so a page with forty chips runs one timer and a page with none
 * runs none.
 *
 * The snapshot is a tick COUNTER, not a timestamp: it only has to change when
 * a re-render is due, and a counter is stable between ticks, as
 * `useSyncExternalStore` requires. Readers take the time from `Date.now()`
 * while rendering.
 */

import { useSyncExternalStore } from "react";

/** How often a provenance age is recomputed. */
export const PRESENTATION_CLOCK_TICK_MS = 15_000;

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      tick += 1;
      for (const l of [...listeners]) l();
    }, PRESENTATION_CLOCK_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return tick;
}

/** Re-renders the caller every {@link PRESENTATION_CLOCK_TICK_MS}. */
export function usePresentationClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
