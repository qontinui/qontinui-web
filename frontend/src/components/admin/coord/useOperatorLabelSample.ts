"use client";

/**
 * The read behind the drill-down's "Did this hold up?" section: coord's
 * weekly label sample (`GET /coord/verification/label-sample`). Separate from
 * `useVerificationMetrics` because only `/admin/coord/verification` reads it —
 * the overview tile never carries the label control.
 *
 * Plan
 * `2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured`,
 * Phase 4.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLabelSample,
  type LabelSampleAnswer,
} from "@/lib/api/operations/coordVerification";

export interface OperatorLabelSampleState {
  /** `null` while reading. */
  answer: LabelSampleAnswer | null;
  reload: () => Promise<void>;
}

function projectsUnloadable(tenantError: string): LabelSampleAnswer {
  return {
    kind: "unavailable",
    status: null,
    code: null,
    message: `the list of projects couldn’t be loaded (${tenantError})`,
  };
}

export function useOperatorLabelSample(
  tenantId: string | null,
  /** Hold the read while the project selection is still loading. */
  hold: boolean,
  /** The project list failed to load: nothing can be read for it. */
  tenantError: string | null
): OperatorLabelSampleState {
  const [answer, setAnswer] = useState<LabelSampleAnswer | null>(null);
  // A later read supersedes an earlier one still in flight.
  const generation = useRef(0);
  // Read by `reload` too, so a manual refresh never fetches over the top of
  // "there is no project to read for".
  const tenantErrorRef = useRef(tenantError);
  tenantErrorRef.current = tenantError;

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    const noProject = tenantErrorRef.current;
    if (noProject !== null) {
      setAnswer(projectsUnloadable(noProject));
      return;
    }
    setAnswer(null);
    const next = await fetchLabelSample();
    if (gen === generation.current) setAnswer(next);
  }, []);

  useEffect(() => {
    if (tenantError !== null) {
      ++generation.current;
      setAnswer(projectsUnloadable(tenantError));
      return;
    }
    if (hold) return;
    // The request carries the active project itself; a switch re-reads.
    void reload();
  }, [hold, reload, tenantError, tenantId]);

  return { answer, reload };
}
