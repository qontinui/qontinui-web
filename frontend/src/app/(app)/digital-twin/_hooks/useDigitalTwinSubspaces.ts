"use client";

import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import type { SubspacesProbeResponse } from "../_lib/types";

const SUBSPACES_URL = "/api/v1/digital-twin/subspaces";

/**
 * Fetch the live per-tenant snapshot-observer probe for the completeness
 * matrix. The backend fans out to coord's SSO-gated twin verdict routes and
 * returns one cell per fleet-wide snapshot sub-space.
 *
 * Refetched on an interval so the matrix tracks the twin as it moves, but not
 * so aggressively that it hammers coord's ~11 live observer reads per load.
 */
export function useDigitalTwinSubspaces() {
  return useQuery({
    queryKey: ["digital-twin", "subspaces"],
    queryFn: () => httpClient.get<SubspacesProbeResponse>(SUBSPACES_URL),
    // Coord recomputes each observer live; a 30s window keeps the matrix fresh
    // without turning the dashboard into a load source.
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}
