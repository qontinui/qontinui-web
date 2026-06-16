"use client";

import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import type { RawVerdictResponse } from "../_lib/types";

/**
 * Fetch the raw DriftVerdict for one sub-space on demand — the exact JSON an AI
 * agent's tools/call receives. Backs the "show raw data" view and the
 * human-digestible summary in the detail drawer.
 *
 * `enabled` gates the fetch so it only fires when the drawer is open for a
 * snapshot sub-space (parameterized / not-built sub-spaces have no raw verdict).
 */
export function useSubspaceRaw(subspaceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["digital-twin", "raw", subspaceId],
    queryFn: () =>
      httpClient.get<RawVerdictResponse>(
        `/api/v1/digital-twin/subspace/${subspaceId}/raw`,
      ),
    enabled: enabled && !!subspaceId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
