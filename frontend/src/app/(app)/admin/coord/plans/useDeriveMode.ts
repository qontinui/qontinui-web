"use client";

/**
 * coord's decay-detection posture — one read of the operations overview.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 3.
 * Read separately from the reconciliation: it is a deployment-wide fact about
 * coord, not a question about the page, so it is not re-read when the window
 * or the search changes — only on mount and when the operator refreshes.
 * A failed re-read keeps the last answer (a deployment's mode does not flip
 * because one request failed); only a first read that fails reads UNKNOWN.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPlansOverview } from "@/lib/api/operations/coordPlans";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { deriveModeOf, type DeriveModeState } from "./deriveMode";

export function useDeriveMode(): {
  state: DeriveModeState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<DeriveModeState>({ state: "pending" });
  const reqId = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const body = await fetchPlansOverview(COORD_DASHBOARD_POLL_OPTIONS);
      if (!mounted.current || id !== reqId.current) return;
      setState({ state: "loaded", mode: deriveModeOf(body) });
    } catch (e) {
      if (!mounted.current || id !== reqId.current) return;
      const reason = e instanceof Error ? e.message : String(e);
      setState((prev) =>
        prev.state === "loaded" ? prev : { state: "failed", reason }
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { state, refresh };
}
