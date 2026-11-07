"use client";

/**
 * The objectives read (`GET /api/v1/overview/objectives`, plan
 * `2026-10-06-overview-objectives-view` D3), for the Objectives page and the
 * Summary's compact metric list.
 *
 * Nothing is read while `hold` is true (the project list has not resolved, or
 * failed — the same rule as every overview read), and the read re-runs when
 * the project changes. A failed read is `error`, never an empty answer.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchObjectives, type ObjectivesRead } from "../_lib/objectives-api";
import { summaryMetricsFrom, type SummaryMetrics } from "../_lib/objectives";

export type ObjectivesState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; read: ObjectivesRead };

export function useObjectives(projectId: string | null, hold: boolean) {
  const [result, setResult] = useState<ObjectivesState>({ state: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (hold) return;
    let live = true;
    setResult({ state: "loading" });
    fetchObjectives().then(
      (read) => live && setResult({ state: "ready", read }),
      (err: unknown) =>
        live &&
        setResult({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [projectId, hold, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { objectives: result, reload };
}

/** The Summary's view of the read: which metrics to list, and their status. */
export function summaryMetricsOf(state: ObjectivesState): SummaryMetrics {
  if (state.state === "loading") return { state: "loading" };
  if (state.state === "error")
    return { state: "failed", message: state.message };
  return summaryMetricsFrom(state.read);
}
