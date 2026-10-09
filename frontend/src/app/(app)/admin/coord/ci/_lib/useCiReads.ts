"use client";

/**
 * The CI dashboard's own polls: `/ci/overview` (page-level — the health strip
 * is derived from it, so it cannot live inside a collapsible panel; style
 * guide R7 "hoist the fetch to the page") and `/pr-merge/merge-economics`
 * (owned by the Repos panel's child, so a CLOSED Repos panel polls nothing).
 * The third read, `/ci-status`, is the existing `useCiStatusStream` WS.
 *
 * Both polls go through the authenticated web proxies — never browser→coord —
 * single-flight with no retries (`COORD_DASHBOARD_POLL_OPTIONS`): the next
 * tick is the retry. Both KEEP the last good value across a failed read and
 * publish the failure beside it (`useRetainedValue`), so the page can label a
 * retained read "stale" instead of presenting it as current (R6's stale arm).
 */

import { useCallback, useState } from "react";
import { useRetainedValue } from "@/components/console";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "@/components/operations/coordPollError";
import { normalizeMergeEconomics } from "@/components/operations/mergeEconomics";
import type { MergeEconomics } from "@/components/operations/mergeTypes";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  fetchCiOverview,
  fetchMergeEconomics,
} from "@/lib/api/operations/prMergeTrain";
import {
  CI_OVERVIEW_POLL_MS,
  type CiOverviewWire,
  type EconomicsRead,
  type OverviewRead,
} from "./ciDashboardStatus";

/** Economics changes on lands, not on a telemetry tick (plan Phase 4: 60 s). */
export const CI_ECONOMICS_POLL_MS = 60_000;

/** A 2xx is a usable overview only when it carries both arrays. */
export function isOverviewBody(body: unknown): body is CiOverviewWire {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return Array.isArray(b.pools) && Array.isArray(b.repos);
}

const ROUTE_UNAVAILABLE_TEXT =
  "this coord does not serve /coord/ci/overview yet (it predates the route) — pool state is unknown, not empty";

export interface CiOverviewPoll extends OverviewRead {
  /** A good read has landed at some point. */
  hasRead: boolean;
  refresh: () => Promise<void> | void;
}

export function useCiOverview(): CiOverviewPoll {
  const retained = useRetainedValue<CiOverviewWire | null>(null);
  const [failureText, setFailureText] = useState<string | null>(null);
  const { issue, settle } = retained;

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      const seq = issue();
      try {
        const body = await fetchCiOverview(COORD_DASHBOARD_POLL_OPTIONS);
        if (!isCurrent()) return;
        if (!isOverviewBody(body)) {
          // A 2xx without the arrays is not "no pools": it is no answer.
          settle(seq, null);
          setFailureText("coord answered without a pools/repos body — unknown");
          return;
        }
        settle(seq, { value: body });
        setFailureText(null);
      } catch (e) {
        if (!isCurrent()) return;
        settle(seq, null);
        setFailureText(
          describeCoordPollError(e, {
            routeUnavailableText: ROUTE_UNAVAILABLE_TEXT,
          })
        );
      }
    },
    [issue, settle]
  );

  const { refresh } = useSingleFlightPoll(poll, CI_OVERVIEW_POLL_MS);
  return {
    data: retained.value,
    failed: failureText !== null,
    failureText,
    hasRead: retained.hasRead,
    refresh,
  };
}

export function useCiEconomics(): EconomicsRead {
  const retained = useRetainedValue<{
    byRepo: Record<string, MergeEconomics>;
    asOf: string | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const { issue, settle } = retained;

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      const seq = issue();
      try {
        const body = await fetchMergeEconomics(COORD_DASHBOARD_POLL_OPTIONS);
        if (!isCurrent()) return;
        settle(seq, { value: normalizeMergeEconomics(body) });
        setFailed(false);
      } catch {
        if (!isCurrent()) return;
        settle(seq, null);
        setFailed(true);
      }
    },
    [issue, settle]
  );

  useSingleFlightPoll(poll, CI_ECONOMICS_POLL_MS);
  return {
    byRepo: retained.value?.byRepo ?? null,
    asOf: retained.value?.asOf ?? null,
    failed,
  };
}
