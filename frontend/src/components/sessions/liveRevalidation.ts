"use client";

/**
 * liveRevalidation — how an OPEN session detail stays current.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 4: *"one list poll
 * plus the existing per-session SSE"*.
 *
 * ## Why this is not a timer
 *
 * The list is polled (`SessionsConsole`'s single 10s interval) because there
 * is no fleet-wide stream to subscribe to. A single OPEN session is different:
 * `GET /operations/sessions/:id/events` already streams that session's
 * `coord.session_events` rows, `subscribeSessionEvents` already consumes it,
 * and `SessionDetail` has mounted it for the events timeline since Phase 8 of
 * `2026-05-23-coord-native-sessions-phase-7-10.md`. Adding a second timer
 * beside a stream that is already open would be a second transport for a
 * question the first one already answers — and two of them race.
 *
 * So the coordination reads an open row makes (claims, agent status, lineage)
 * are re-issued when that session's own stream says something happened, and
 * never on a clock.
 *
 * ## The denylist, and which way it fails
 *
 * `coord.session_events.event_kind` is a bare `TEXT` column with **no CHECK
 * constraint** coord-side, so its vocabulary is open and a fixed allowlist
 * here would silently ignore every kind added after this file was written.
 * The filter is therefore a DENYLIST of the two high-volume kinds that cannot
 * change the coordination half:
 *
 * - `output_chunk` — PTY bytes. Thousands per session; lives in
 *   `coord.session_output`, not the events table at all.
 * - `heartbeat` — liveness at coord's 15s cadence. Left in, it would quietly
 *   turn this into a 15s poll of three endpoints, which is the exact thing
 *   Phase 4 removes.
 *
 * An unrecognized new kind falls through and triggers one revalidation. That
 * is the correct failure direction: possibly-wasteful, never silently missed.
 *
 * ## Coalescing
 *
 * Coord's SSE route **replays the last 100 events before it live-tails**, so a
 * subscription opens with a burst. Every trigger inside a
 * {@link REVALIDATE_COALESCE_MS} window collapses into ONE revalidation: the
 * first qualifying event arms a trailing timer and the rest of the burst is
 * absorbed by it. A connect-time replay therefore costs at most one extra
 * read, and one row is open at a time no matter how large the fleet is.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { subscribeSessionEvents } from "./api";

/**
 * Trailing window a burst of events collapses into. Sized for the connect-time
 * replay (arrives in one chunk read, well inside a second), not for pacing —
 * this is not a poll interval and must not be read as one.
 */
export const REVALIDATE_COALESCE_MS = 1_000;

/**
 * Event kinds that cannot change a session's coordination half. See the
 * module docstring for why this is a denylist rather than an allowlist.
 */
export const NON_REVALIDATING_EVENT_KINDS: ReadonlySet<string> = new Set([
  "output_chunk",
  "heartbeat",
]);

/** Should this event cause the open detail's reads to be re-issued? */
export function isRevalidatingEvent(event: {
  event_kind?: string | null;
}): boolean {
  const kind = event.event_kind;
  if (typeof kind !== "string" || kind === "") return false;
  return !NON_REVALIDATING_EVENT_KINDS.has(kind);
}

/** The stream this hook consumes. Injected in tests; never a second transport. */
export type SessionEventSubscriber = typeof subscribeSessionEvents;

export interface SessionRevalidationOptions {
  /** Injected for tests. Defaults to the shipped per-session SSE client. */
  subscribe?: SessionEventSubscriber;
  /** Injected for tests. Defaults to {@link REVALIDATE_COALESCE_MS}. */
  coalesceMs?: number;
}

/** A coalescing gate: `trigger()` many times, `revalidate` runs once. */
export interface CoalescedRevalidator {
  /** Ask for a revalidation. Absorbed if one is already armed. */
  trigger: () => void;
  /** Drop a pending revalidation — a collapsed row must not fire one later. */
  cancel: () => void;
}

/**
 * The coalescing half on its own, so a component that ALREADY holds an open
 * `subscribeSessionEvents` subscription (`SessionDetail`, for its events
 * timeline) can drive a revalidation off that one stream instead of opening a
 * second connection to the same endpoint.
 *
 * `revalidate` is held in a ref, so a caller passing a fresh closure every
 * render neither re-arms the timer nor invalidates `trigger`'s identity.
 */
export function useCoalescedRevalidator(
  revalidate: () => void,
  coalesceMs: number = REVALIDATE_COALESCE_MS
): CoalescedRevalidator {
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const torn = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const trigger = useCallback(() => {
    // Already armed — this call is absorbed by the pending trailing fire.
    if (torn.current || timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!torn.current) revalidateRef.current();
    }, coalesceMs);
  }, [coalesceMs]);

  useEffect(() => {
    torn.current = false;
    return () => {
      torn.current = true;
      cancel();
    };
  }, [cancel]);

  return useMemo(() => ({ trigger, cancel }), [trigger, cancel]);
}

/**
 * While `enabled`, follow one session's SSE stream and call `revalidate` when
 * something that matters happens on it.
 *
 * Teardown cancels the coalescing timer AND aborts the stream's underlying
 * fetch, so a collapsed row and an unmounted console both leave nothing
 * running — a row shut with a trigger already armed must not issue three reads
 * a second later for a panel nobody is looking at.
 */
export function useSessionEventRevalidation(
  sessionId: string | null | undefined,
  enabled: boolean,
  revalidate: () => void,
  options: SessionRevalidationOptions = {}
): void {
  const { subscribe, coalesceMs = REVALIDATE_COALESCE_MS } = options;
  const { trigger, cancel } = useCoalescedRevalidator(revalidate, coalesceMs);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const unsubscribe = (subscribe ?? subscribeSessionEvents)(sessionId, {
      onEvent: (row) => {
        if (isRevalidatingEvent(row)) trigger();
      },
      // A dropped stream is not evidence about the session, and it is not this
      // hook's to report: the detail keeps whatever it last read, labelled by
      // `foldRevalidation`. Swallowing it here only means we stop refreshing.
      onError: () => {},
    });

    return () => {
      cancel();
      unsubscribe();
    };
  }, [sessionId, enabled, subscribe, trigger, cancel]);
}
