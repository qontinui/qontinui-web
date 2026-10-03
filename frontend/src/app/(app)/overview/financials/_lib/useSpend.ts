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

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** `refreshing`: a re-read (another view, another breakdown) is in
   *  flight and `data` is the previous answer, kept on screen until the new
   *  one lands. Never set across a project change. */
  | { state: "ready"; data: T; refreshing?: boolean };

export type BreakdownBy = "scope" | "sku";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One read. A re-read for the SAME project keeps the previous answer on
 * screen (marked `refreshing`) instead of blanking to a skeleton; a change of
 * `resetKey` (the project) starts from loading, so one project's figures are
 * never shown under another's name. A failed re-read replaces the old answer
 * with the failure — stale figures are not passed off as the new view's.
 */
function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  hold: boolean,
  resetKey: unknown
): [Loadable<T>, () => void] {
  const [value, setValue] = useState<Loadable<T>>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  const lastResetKey = useRef<unknown>(resetKey);
  useEffect(() => {
    const sameProject = Object.is(lastResetKey.current, resetKey);
    lastResetKey.current = resetKey;
    // A project change drops the old project's answer at once — even while
    // reads are held — so it is never shown under the new project's name.
    if (!sameProject) setValue({ state: "loading" });
    if (hold) return;
    let live = true;
    setValue((prev) =>
      sameProject && prev.state === "ready"
        ? { ...prev, refreshing: true }
        : { state: "loading" }
    );
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
  }, [...deps, resetKey, hold, nonce]);
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
    [view],
    hold,
    projectId
  );
  const [breakdown, reloadBreakdown] = useLoad<SpendSummary>(
    () =>
      fetchSpendSummary({
        view,
        groupBy: breakdownBy,
        vendor: breakdownVendor,
      }),
    [view, breakdownBy, breakdownVendor],
    hold,
    projectId
  );
  const [renewals, reloadRenewals] = useLoad<Renewal[]>(
    () => fetchRenewals(60),
    [],
    hold,
    projectId
  );

  /** After a recurring cost is added, every figure may have moved. */
  const reloadAll = useCallback(() => {
    reloadSummary();
    reloadBreakdown();
    reloadRenewals();
  }, [reloadSummary, reloadBreakdown, reloadRenewals]);

  return { summary, breakdown, renewals, reloadAll };
}
