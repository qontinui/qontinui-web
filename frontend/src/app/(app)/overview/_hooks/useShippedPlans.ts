"use client";

import { useEffect, useState } from "react";
import { PLAN_FETCH_LIMIT, fetchPlanRows } from "../_lib/plans-api";
import { shippedPlans, type ShippedPlans } from "../_lib/progress";

export type ShippedPlansState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; shipped: ShippedPlans };

/**
 * The project's shipped plans, for the Timeline's lane. Nothing is read while
 * `hold` is true (the active project is not settled yet), and a result is
 * kept with the project it was read for, so another project's plans — or its
 * failure — never show after a switch.
 */
export function useShippedPlans(
  projectId: string | null,
  hold: boolean
): ShippedPlansState {
  const [value, setValue] = useState<{
    about: string | null;
    result: ShippedPlansState;
  }>({ about: null, result: { state: "loading" } });
  useEffect(() => {
    if (hold) return;
    let live = true;
    fetchPlanRows().then(
      (rows) =>
        live &&
        setValue({
          about: projectId,
          result: {
            state: "ready",
            shipped: shippedPlans(rows, { fetchLimit: PLAN_FETCH_LIMIT }),
          },
        }),
      (err: unknown) =>
        live &&
        setValue({
          about: projectId,
          result: {
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        })
    );
    return () => {
      live = false;
    };
  }, [projectId, hold]);
  return value.about === projectId && !hold
    ? value.result
    : { state: "loading" };
}
