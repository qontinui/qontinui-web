"use client";

/**
 * Everything the Costs page reads. Each read reports `loading`, `error` or
 * its data on its own, so one failing never blanks the others, and no failure
 * is shown as an empty (let alone a $0) project.
 *
 * Nothing is read while `hold` is true — the active-project header comes from
 * the project list, and an earlier read could answer for the wrong project.
 * `projectId` re-runs every read when the project changes.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fetchRenewals,
  fetchSpendSummary,
  type Renewal,
  type SpendSummary,
  type SpendView,
} from "./spend-api";

export type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

export type BreakdownBy = "scope" | "sku";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  hold: boolean
): [Loadable<T>, () => void] {
  const [value, setValue] = useState<Loadable<T>>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (hold) return;
    let live = true;
    setValue({ state: "loading" });
    load().then(
      (data) => live && setValue({ state: "ready", data }),
      (err: unknown) =>
        live && setValue({ state: "error", message: message(err) })
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt every render; `deps` names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, hold, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return [value, reload];
}

export function useSpend({
  projectId,
  hold,
  view,
  breakdownBy,
  breakdownVendor,
}: {
  projectId: string | null;
  hold: boolean;
  view: SpendView;
  breakdownBy: BreakdownBy;
  breakdownVendor: string | null;
}) {
  const [summary, reloadSummary] = useLoad<SpendSummary>(
    () => fetchSpendSummary({ view, groupBy: "day" }),
    [projectId, view],
    hold
  );
  const [breakdown, reloadBreakdown] = useLoad<SpendSummary>(
    () =>
      fetchSpendSummary({
        view,
        groupBy: breakdownBy,
        vendor: breakdownVendor,
      }),
    [projectId, view, breakdownBy, breakdownVendor],
    hold
  );
  const [renewals, reloadRenewals] = useLoad<Renewal[]>(
    () => fetchRenewals(60),
    [projectId],
    hold
  );

  /** After a recurring cost is added, every figure may have moved. */
  const reloadAll = useCallback(() => {
    reloadSummary();
    reloadBreakdown();
    reloadRenewals();
  }, [reloadSummary, reloadBreakdown, reloadRenewals]);

  return { summary, breakdown, renewals, reloadAll };
}
