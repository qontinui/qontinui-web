"use client";

/**
 * The plan library's difficulty ratings, for `/admin/coord/work-units`.
 *
 * A SECOND read beside the page's coord work-unit list, because the rating
 * lives on the plan-library artifact, not on the work unit (see
 * `components/admin/coord/planDifficulty.ts`). Kept separate from the page's
 * 10 s poll on purpose: a rating changes only when a plan BODY changes, so
 * polling it at the work-unit cadence would re-send the whole corpus's ratings
 * every ten seconds for nothing. It refreshes on mount, every
 * {@link DIFFICULTY_POLL_MS}, and whenever the operator presses refresh.
 *
 * While the backend reports `rerate_pending > 0` (it rates a capped batch per
 * read, so a deploy leaves a backlog), the hook re-reads every
 * {@link DIFFICULTY_BACKLOG_MS} until the backlog is gone.
 *
 * A failed re-read keeps the last good index (the ratings a failure cannot
 * have changed) and only a FIRST read that fails reports `failed` — the same
 * "a poll must never blank a loaded page" rule the page follows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlight } from "@/components/operations/useSingleFlightPoll";
import {
  indexDifficulty,
  type DifficultyIndex,
  type PlanDifficultyResponse,
} from "@/components/admin/coord/planDifficulty";

const ENDPOINT = "/api/v1/plan-library/difficulty";
export const DIFFICULTY_POLL_MS = 5 * 60_000;
/** Re-read delay while the backend reports a rating backlog. Each read rates
 *  a capped batch, so this is what works a post-deploy backlog down. */
export const DIFFICULTY_BACKLOG_MS = 3_000;

export function usePlanDifficulty(): {
  index: DifficultyIndex;
  refresh: () => Promise<void>;
} {
  const [index, setIndex] = useState<DifficultyIndex>({ state: "pending" });
  /** The pending backlog re-read, so a newer read or unmount can cancel it. */
  const backlogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `refresh` itself, for the backlog timer the read schedules. Set in the
   *  effect, never during render. */
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Single-flight, no retries (plan
  // `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5): one
  // request per tick, never overlapping itself, and a failed read is retried by
  // the next tick rather than by `httpClient`'s 5xx backoff chain. The route is
  // served by the web backend itself, but a retried 5xx multiplies load there
  // just the same. `isCurrent()` turns false on unmount, which is what stops a
  // late answer landing.
  const read = useCallback(async (isCurrent: () => boolean) => {
    if (backlogTimer.current) clearTimeout(backlogTimer.current);
    backlogTimer.current = null;
    try {
      const body = await httpClient.get<PlanDifficultyResponse>(
        ENDPOINT,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (!isCurrent()) return;
      setIndex(indexDifficulty(body));
      if ((body.rerate_pending ?? 0) > 0) {
        backlogTimer.current = setTimeout(
          () => void refreshRef.current(),
          DIFFICULTY_BACKLOG_MS
        );
      }
    } catch (e) {
      if (!isCurrent()) return;
      const reason = e instanceof Error ? e.message : String(e);
      setIndex((prev) =>
        prev.state === "loaded" ? prev : { state: "failed", reason }
      );
    }
  }, []);

  // Not `useSingleFlightPoll`: the backlog re-read is a second, faster timer
  // that goes through the same latch. Called before the effects below so its
  // `activeRef` is set first.
  const { refresh, tick } = useSingleFlight(read);

  useEffect(() => {
    refreshRef.current = refresh;
    void refresh();
    const id = setInterval(tick, DIFFICULTY_POLL_MS);
    return () => {
      clearInterval(id);
      // Drop a scheduled backlog re-read.
      if (backlogTimer.current) clearTimeout(backlogTimer.current);
      backlogTimer.current = null;
    };
  }, [refresh, tick]);

  return { index, refresh };
}
