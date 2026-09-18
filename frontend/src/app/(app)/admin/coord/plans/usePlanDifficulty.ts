"use client";

/**
 * The plan library's difficulty ratings, for `/admin/coord/plans`.
 *
 * A SECOND read beside the page's coord work-unit list, because the rating
 * lives on the plan-library artifact, not on the work unit (see
 * `components/admin/coord/planDifficulty.ts`). Kept separate from the page's
 * 10 s poll on purpose: a rating changes only when a plan BODY changes, so
 * polling it at the work-unit cadence would re-send the whole corpus's ratings
 * every ten seconds for nothing. It refreshes on mount, every
 * {@link DIFFICULTY_POLL_MS}, and whenever the operator presses refresh.
 *
 * A failed re-read keeps the last good index (the ratings a failure cannot
 * have changed) and only a FIRST read that fails reports `failed` — the same
 * "a poll must never blank a loaded page" rule the page follows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import {
  indexDifficulty,
  type DifficultyIndex,
  type PlanDifficultyResponse,
} from "@/components/admin/coord/planDifficulty";

const ENDPOINT = "/api/v1/plan-library/difficulty";
export const DIFFICULTY_POLL_MS = 5 * 60_000;

export function usePlanDifficulty(): {
  index: DifficultyIndex;
  refresh: () => Promise<void>;
} {
  const [index, setIndex] = useState<DifficultyIndex>({ state: "pending" });
  /** The newest read wins; an overtaken one may not land. */
  const reqGen = useRef(0);

  const refresh = useCallback(async () => {
    const req = ++reqGen.current;
    try {
      const body = await httpClient.get<PlanDifficultyResponse>(ENDPOINT);
      if (req !== reqGen.current) return;
      setIndex(indexDifficulty(body));
    } catch (e) {
      if (req !== reqGen.current) return;
      const reason = e instanceof Error ? e.message : String(e);
      setIndex((prev) =>
        prev.state === "loaded" ? prev : { state: "failed", reason }
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), DIFFICULTY_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { index, refresh };
}
