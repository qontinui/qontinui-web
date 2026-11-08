"use client";

/**
 * What the Timeline reads, assembled once: the project's estimate (the
 * baseline, else the newest), its phases' progress, its milestones and the
 * server's forecast, joined into the phases the chart and the list draw.
 *
 * The Timeline page reads through it, and so do the live blocks that show the
 * Timeline elsewhere (`overview-kpi`, `overview-timeline`,
 * `overview-plan-vs-actual` — plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3), so
 * a figure on a document and the same figure on the Timeline come from the
 * same reads, joined the same way.
 *
 * Every read holds while `hold` is true (the active project is not yet
 * known) and re-runs when the project changes. Loading, failure and "no
 * estimate yet" stay apart; none of them is an empty schedule.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSharedRead } from "@/components/overview/editing/sharedReads";
import {
  useResourceList,
  useResourceRecord,
} from "@/components/overview/editing/useResource";
import {
  ESTIMATES,
  pickBaseline,
  type EstimateRecord,
  type PhaseTaskRead,
} from "../_lib/estimate-api";
import {
  MILESTONES_PATH,
  PHASE_PROGRESS_PATH,
  fetchForecast,
  type Milestone,
  type PhaseProgress,
  type TimelineForecast,
} from "../_lib/timeline-api";
import { projectWindow, toDay } from "../_lib/timeline";
import { assemblePhases } from "../timeline/_components/model";

export type ForecastState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; forecast: TimelineForecast };

/** The forecast for `estimateId`, re-read whenever `token` moves (after a
 *  progress write, which is what changes it). Blocks on one document share
 *  one read of it (`sharedReads.tsx`). */
export function useForecast(
  estimateId: string | null,
  hold: boolean,
  token: number
): ForecastState {
  const [value, setValue] = useState<ForecastState>({ state: "loading" });
  const share = useSharedRead();
  useEffect(() => {
    if (hold || estimateId === null) return;
    let live = true;
    share(["forecast", estimateId, token], () =>
      fetchForecast(estimateId)
    ).then(
      (forecast) => live && setValue({ state: "ready", forecast }),
      (err: unknown) =>
        live &&
        setValue({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [estimateId, hold, token, share]);
  return value;
}

/** The project's estimates, and the one the Timeline plans from. */
export function useBaselineEstimate(projectId: string | null, hold: boolean) {
  const estimates = useResourceList<EstimateRecord>(ESTIMATES, {
    hold,
    reloadKey: projectId,
  });
  const estimate =
    estimates.list.state === "ready"
      ? pickBaseline(estimates.list.items)
      : null;
  return { estimates, estimate };
}

export function useTimelineData(projectId: string | null, hold: boolean) {
  const { estimates, estimate } = useBaselineEstimate(projectId, hold);
  const estimateId = estimate?.id ?? null;
  const record = useResourceRecord<EstimateRecord>(ESTIMATES, estimateId, {
    hold,
    reloadKey: projectId,
  });
  const progress = useResourceList<PhaseProgress>(PHASE_PROGRESS_PATH, {
    params: estimateId ? { estimate_id: estimateId } : {},
    hold: hold || estimateId === null,
    reloadKey: projectId,
  });
  const milestones = useResourceList<Milestone>(MILESTONES_PATH, {
    hold,
    reloadKey: projectId,
  });
  const [forecastToken, setForecastToken] = useState(0);
  const forecast = useForecast(estimateId, hold, forecastToken);
  /** Re-read the forecast — after a progress write, which changes it. */
  const refreshForecast = useCallback(() => setForecastToken((n) => n + 1), []);

  const content =
    record.record.state === "ready" ? record.record.item.content : null;
  const tasks = useMemo(() => {
    const byPhase = new Map<string, PhaseTaskRead[]>();
    for (const phase of content?.phases ?? [])
      byPhase.set(phase.id, phase.tasks);
    return byPhase;
  }, [content]);
  const breaks = content?.calendar_breaks ?? [];
  const phases = useMemo(
    () =>
      progress.list.state === "ready"
        ? assemblePhases(
            progress.list.items,
            tasks,
            forecast.state === "ready" ? forecast.forecast.phases : null
          )
        : [],
    [progress.list, tasks, forecast]
  );
  const milestoneItems =
    milestones.list.state === "ready" ? milestones.list.items : [];

  const today =
    toDay(forecast.state === "ready" ? forecast.forecast.today : null) ??
    new Date();
  /** Every day the chart draws (planned, actual, forecast, milestones,
   *  breaks), so nothing it holds falls off the edge; null with none. */
  const projectSpan = projectWindow([
    ...phases.flatMap((p) => [
      p.progress.planned_start,
      p.progress.planned_end,
      p.progress.actual_start,
      p.progress.actual_end,
      p.forecast?.forecast_end,
    ]),
    ...milestoneItems.map((m) => m.target_date),
    ...breaks.flatMap((b) => [b.start_date, b.end_date]),
  ]);

  return {
    estimates,
    estimate,
    estimateId,
    record,
    progress,
    milestones,
    forecast,
    refreshForecast,
    breaks,
    phases,
    milestoneItems,
    today,
    projectSpan,
  };
}
