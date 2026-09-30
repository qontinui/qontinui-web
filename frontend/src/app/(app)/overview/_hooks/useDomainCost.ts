"use client";

/**
 * `GET /api/v1/operations/domain-cost` — coord's domain cost ledger, for the
 * Overview's "Domain cost" cards.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8. Mirrors `useFleetHealth`: single-flight, no retries (the next tick
 * is the retry), and a failed read KEEPS the last body — a failed read is
 * evidence about the network, not about the ledger, and clearing it would
 * render every figure unknown on a transient blip without saying why.
 *
 * Per project like every other Overview read: nothing is read while `hold`
 * is true (the project list has not resolved, or failed — the active-tenant
 * header would name a project the page cannot), and a project change is a
 * changed question, answered at once.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import {
  COORD_DASHBOARD_POLL_OPTIONS,
  describeCoordPollError,
} from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import { isDomainCostPayload, type DomainCostPayload } from "../_lib/domainCost";

export const DOMAIN_COST_API = "/api/v1/operations/domain-cost";

/**
 * Poll cadence. The ledger moves when a work unit ships, not second to
 * second, and coord bounds one read at 20 s of database work — so five
 * minutes, which is still fresh enough that a verdict change is seen the
 * same session.
 */
export const DOMAIN_COST_POLL_MS = 5 * 60_000;

export interface UseDomainCostResult {
  data: DomainCostPayload | null;
  loading: boolean;
  /** Transport failure; `data` is kept. */
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDomainCost(
  tenantId: string | null,
  hold: boolean,
  /**
   * Why the read is held when it will NOT resolve by waiting — the project
   * list failed. Surfaced as the read's error, so the section says why it has
   * nothing rather than "not read yet" forever.
   */
  holdReason: string | null = null
): UseDomainCostResult {
  const [data, setData] = useState<DomainCostPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A different project's ledger must not be shown under this one's name, so
  // a project change drops the retained body before the new read lands.
  const [dataTenant, setDataTenant] = useState<string | null>(tenantId);
  if (dataTenant !== tenantId) {
    setDataTenant(tenantId);
    setData(null);
    setError(null);
    setLoading(true);
  }

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      if (hold) return;
      try {
        const body = await httpClient.get<unknown>(
          DOMAIN_COST_API,
          COORD_DASHBOARD_POLL_OPTIONS
        );
        if (!isCurrent()) return;
        if (!isDomainCostPayload(body)) {
          setError("coord answered without a domain cost ledger");
          return;
        }
        setData(body);
        setError(null);
      } catch (e) {
        if (!isCurrent()) return;
        setError(
          describeCoordPollError(e, {
            routeUnavailableText: "coord does not serve the domain cost ledger yet",
          })
        );
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    // `tenantId` is a dependency on purpose even though the request does not
    // name it: the active-tenant header does, and a new `poll` identity is
    // what makes the poll re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantId, hold]
  );

  const { refresh } = useSingleFlightPoll(poll, DOMAIN_COST_POLL_MS, {
    supersedeOnChange: true,
  });

  if (hold && holdReason !== null) {
    return {
      data: null,
      loading: false,
      error: `project list unavailable: ${holdReason}`,
      refresh,
    };
  }
  return { data, loading, error, refresh };
}
