"use client";

/**
 * StalledSubprojectsLine — `/admin/coord/home`'s one line about subprojects:
 * how many have nothing moving them, linking to the list (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * F3, folded into Phase 6).
 *
 * The count is coord's `total` for `GET /subprojects?headline=stalled` — the
 * open subprojects whose cached verdict is `stalled` (D1, D6). It is a dash
 * until a read answers (R6); a later failed read keeps the last count and says
 * so; a pending migration or an undeployed door is named as what it is. The
 * wording is `subprojectStatus.ts` `describeStalledLine`.
 *
 * Its read is its OWN, on the page's 60 s cadence and only while the tab is
 * visible, and the line mounts inside `OperatorOnly`: the subprojects page is
 * not presentation-ready, so while presenting the line — and its read — are
 * not there at all, and the overview presents exactly what it did before
 * (style guide §3.14: "Nothing new is fetched").
 */

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRetainedValue } from "@/components/console";
import { useVisiblePoll } from "@/components/admin/coord/useVisiblePoll";
import { PROJECT_STATE_POLL_MS } from "@/components/admin/coord/coordHomeStatus";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { fetchSubprojects } from "@/lib/api/operations/coordSubprojects";
import {
  classifySubprojectReadFailure,
  describeStalledLine,
  viewQuery,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import { useStampedFailure } from "@/components/admin/coord/subprojects/useStampedFailure";

/** The one question this line asks, as the failure bookkeeping stamps it. */
const STALLED = "stalled";

/** The read: coord's count of open subprojects headlined `stalled`. */
function useStalledSubprojectCount() {
  const axis = useRetainedValue<number | null>(null);
  // Stamped with the read's sequence number: an older read that succeeds
  // after a newer one failed cannot clear the newer failure.
  const failures = useStampedFailure<typeof STALLED>();
  const { fail, succeed } = failures;
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);
  const { issue, settle } = axis;
  const read = useCallback(async () => {
    const seq = issue();
    try {
      const page = await fetchSubprojects(
        viewQuery("stalled", 1),
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (cancelled.current) return;
      settle(seq, {
        value: typeof page.total === "number" ? page.total : null,
      });
      succeed(STALLED, seq);
    } catch (err) {
      if (cancelled.current) return;
      settle(seq, null);
      fail(STALLED, seq, classifySubprojectReadFailure(err));
    }
  }, [issue, settle, fail, succeed]);
  useVisiblePoll(read, PROJECT_STATE_POLL_MS, { runOnMount: true });
  return {
    count: axis.value,
    loaded: axis.hasRead,
    stale: axis.stale,
    failure: failures.failureFor(STALLED),
  };
}

export function StalledSubprojectsLine() {
  const { count, loaded, stale, failure } = useStalledSubprojectCount();
  const line = describeStalledLine({ count, loaded, stale, failure });
  return (
    <p
      className="m-0 text-sm text-muted-foreground"
      data-testid="coord-home.stalled-subprojects"
      data-ui-bridge-id="coord-home.stalled-subprojects"
    >
      <Link
        href="/admin/coord/subprojects?tab=stalled"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Subprojects with nothing moving them
      </Link>
      :{" "}
      <span
        className="font-mono text-foreground"
        data-testid="coord-home.stalled-subprojects.count"
      >
        {line.value}
      </span>
      {line.note ? <span> — {line.note}</span> : null}
    </p>
  );
}
