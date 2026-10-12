"use client";

/**
 * The estimate the overview pages read, and its rolled-up figures.
 *
 * Three states are kept apart on purpose, because they mean different things
 * to a reader: `loading`, `error` (we could not ask), and `ready` with
 * `estimate: null` (we asked, and this project has no estimate yet). Only the
 * last is an empty state; the other two must never render as one.
 *
 * Reads are held until the project list has resolved. The active project is
 * sent as a header by `httpClient` for the `/api/v1/overview/` prefix, so a
 * read issued before the selection settles would answer for a project the
 * page cannot name.
 */

import { useCallback, useEffect, useState } from "react";
import { listResource } from "@/components/overview/editing/api";
import {
  ESTIMATES,
  fetchRollup,
  fetchSettings,
  pickBaseline,
  type EstimateRecord,
  type EstimateRollup,
  type OverviewSettings,
} from "../_lib/estimate-api";

export type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | ({ state: "ready" } & T);

export interface EstimateData {
  /** `null` when this project has no estimate at all. Head row only. */
  estimate: EstimateRecord | null;
  /** Every estimate, so the editor can offer them. Baseline first. */
  estimates: EstimateRecord[];
  /** `null` only when there is no estimate to roll up. */
  rollup: EstimateRollup | null;
  settings: OverviewSettings;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useEstimate(tenantId: string | null, hold: boolean) {
  const [data, setData] = useState<Loadable<EstimateData>>({
    state: "loading",
  });
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (hold) return;
    let live = true;
    setData({ state: "loading" });
    (async () => {
      // Settings and the estimate list are independent reads, so they go out
      // together; the rollup needs an id and follows.
      const [settings, listed] = await Promise.all([
        fetchSettings(),
        listResource<EstimateRecord>(ESTIMATES),
      ]);
      const estimate = pickBaseline(listed.items);
      const rollup = estimate ? await fetchRollup(estimate.id) : null;
      return { settings, estimates: listed.items, estimate, rollup };
    })().then(
      (loaded) => live && setData({ state: "ready", ...loaded }),
      (err) => live && setData({ state: "error", message: errorMessage(err) })
    );
    return () => {
      live = false;
    };
  }, [tenantId, hold, reloadToken]);

  return { data, reload };
}
