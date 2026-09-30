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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "@/components/operations/coordPollError";
import {
  PROJECT_STATE_API,
  PROJECT_STATE_POLL_MS,
  parseProjectState,
  type ProjectStateView,
} from "@/components/admin/coord/coordHomeStatus";
import { httpClient } from "@/services/service-factory";

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

  const read = useCallback(async () => {
    const seq = issue();
    try {
      const body = await httpClient.get<unknown>(
        PROJECT_STATE_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
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
      setLastError(
        describeCoordPollError(err, {
          routeUnavailableText:
            "this deployment does not serve the project-state door yet — unknown",
        })
      );
    }
  }, [issue, settle]);

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
