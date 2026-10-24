"use client";

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
 * while rendering — but never on a server render or during hydration: there
 * the snapshot is {@link NOT_ON_THE_CLIENT}, {@link usePresentationNow} is
 * `null`, and an age renders as {@link stableInstantText}, which reads the
 * same on the server and in every browser. The client's next render ages it.
 */

import { useSyncExternalStore } from "react";
import { relativeTime } from "@/components/console/time";

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

/** The server and hydration snapshot: no client clock may be read yet. */
export const NOT_ON_THE_CLIENT = -1;

function getServerSnapshot(): number {
  return NOT_ON_THE_CLIENT;
}

/**
 * Re-renders the caller every {@link PRESENTATION_CLOCK_TICK_MS}. The tick
 * count, or {@link NOT_ON_THE_CLIENT} on a server render and during hydration.
 */
export function usePresentationClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The time to age a figure against, re-read every tick — or `null` on a
 * server render and during hydration, where any clock reading would disagree
 * with the HTML it is hydrating.
 */
export function usePresentationNow(): number | null {
  return usePresentationClock() === NOT_ON_THE_CLIENT ? null : Date.now();
}

/**
 * An instant as text that reads the same on a server and in any browser —
 * UTC, to the minute — for a render that has no client clock to age it by.
 */
export function stableInstantText(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * How old `iso` is, as the presentation lens says it: `absent` when there is
 * no instant, {@link stableInstantText} when `now` is `null`, "under a minute
 * ago" below a minute — the clock ticks every
 * {@link PRESENTATION_CLOCK_TICK_MS}, so a seconds count would understate an
 * age by up to a tick between them — and otherwise the console's own age.
 */
export function presentationAge(
  iso: string | null | undefined,
  now: number | null,
  absent: string
): string {
  if (!iso) return absent;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return absent;
  if (now === null) return stableInstantText(new Date(then).toISOString());
  if (now - then < 60_000) return "under a minute ago";
  return relativeTime(iso, { absent, now });
}
