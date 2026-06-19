"use client";

import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import type { DeliveryVerdictResponse } from "../_lib/types";

/**
 * Fetch the delivery verdict for one plan — "has this plan/PR landed?". The
 * parameterized twin read (Phase 5): unlike the snapshot matrix it needs a
 * `plan_slug`, so it fires on demand (a submitted slug), never on mount. The
 * backend proxies coord's SSO-gated `GET /coord/twin/delivery/verdict`, which
 * dispatches the same `coord_query_delivery` tool an agent calls with
 * `force_refresh=true` — so the card's answer is byte-identical to, and as fresh
 * as, the agent's.
 *
 * `slug` is the submitted plan slug (empty until the user looks one up); the
 * fetch is gated on a non-empty slug so the page mounts (and the Spec CI crawl
 * renders) without ever hitting coord.
 */
export function useDeliveryVerdict(slug: string) {
  const trimmed = slug.trim();
  return useQuery({
    queryKey: ["digital-twin", "delivery", trimmed],
    queryFn: () =>
      httpClient.get<DeliveryVerdictResponse>(
        `/api/v1/digital-twin/delivery/verdict?plan_slug=${encodeURIComponent(trimmed)}`,
      ),
    enabled: trimmed.length > 0,
    // A point query is already force-refreshed server-side; a short staleTime
    // keeps a fresh slug lookup live without hammering coord on window focus.
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
