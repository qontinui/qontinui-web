"use client";

/**
 * useProjectState — the ONE read `/admin/coord/home` makes.
 *
 * Polls `GET /api/v1/operations/project-state` every 60 s (gated on tab
 * visibility, single-flight) and keeps the last body that parsed. A failed or
 * empty poll does NOT blank the page and does NOT silently freeze it: the
 * retained view stays on screen and `stale` says a newer read did not replace
 * it, so the page can stamp the view with its age (`useRetainedValue` +
 * `readSequence`, style guide R6). No client retries — the next tick is the
 * retry (`COORD_DASHBOARD_POLL_OPTIONS`).
 *
 * `refresh()` returns its promise so `<RefreshButton>` can acknowledge the
 * press for exactly as long as the read is out.
 *
 * ## One read at a time, for the poll AND the button
 *
 * The poll's own single-flight guard lives inside `useVisiblePoll`, which a
 * press never passes through. So `read` carries its own: while a read is out,
 * calling it again returns THAT read's promise instead of issuing a second
 * one. A press during a poll therefore joins the poll's read (its answer is
 * the press's answer, and the button stays busy until it lands), and a slow
 * coord is never asked twice at once. With reads serialised, `lastError` is
 * always set by the newest read to finish, so it cannot disagree with
 * `stale`: an older success landing after a newer failure, or an older
 * failure landing after a newer success, can no longer happen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  PROJECT_STATE_POLL_MS,
  parseProjectState,
  projectStateErrorText,
  type ProjectStateView,
} from "@/components/admin/coord/coordHomeStatus";
import { fetchProjectState } from "@/lib/api/operations/projectState";

export interface ProjectStateRead {
  /** The last view that parsed, or null when none ever did. */
  view: ProjectStateView | null;
  /** Has any read ever delivered a view? */
  hasRead: boolean;
  /** A newer read finished without replacing `view`. */
  stale: boolean;
  /** Why the most recent read delivered nothing, or null after a success. */
  lastError: string | null;
  refresh: () => Promise<void>;
}

export function useProjectState(): ProjectStateRead {
  const retained = useRetainedValue<ProjectStateView | null>(null);
  const { issue, settle } = retained;
  const [lastError, setLastError] = useState<string | null>(null);
  const cancelled = useRef(false);
  // The read that is out, if any (see "One read at a time").
  const inFlight = useRef<Promise<void> | null>(null);

  const readOnce = useCallback(async () => {
    const seq = issue();
    try {
      const body = await fetchProjectState(COORD_DASHBOARD_POLL_OPTIONS);
      if (cancelled.current) return;
      const view = parseProjectState(body);
      if (view) {
        settle(seq, { value: view });
        setLastError(null);
      } else {
        settle(seq, null);
        setLastError("coord answered with a body that is not a project state");
      }
    } catch (err) {
      if (cancelled.current) return;
      settle(seq, null);
      setLastError(projectStateErrorText(err));
    }
  }, [issue, settle]);

  // `readOnce` records its own failures (its catch), and `finally` frees the
  // slot however the read settles, so a failed read never wedges the guard.
  const read = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const pending = readOnce().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = pending;
    return pending;
  }, [readOnce]);

  // Declared before the poll so the mount read sees `cancelled === false`.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, [read]);

  useVisiblePoll(read, PROJECT_STATE_POLL_MS, { runOnMount: true });

  return {
    view: retained.value,
    hasRead: retained.hasRead,
    stale: retained.stale,
    lastError,
    refresh: read,
  };
}
