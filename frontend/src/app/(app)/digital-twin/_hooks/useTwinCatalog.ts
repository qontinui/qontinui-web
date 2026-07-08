"use client";

import { useQuery } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import type { TwinCatalogResponse } from "../_lib/types";

const CATALOG_URL = "/api/v1/digital-twin/catalog";

/**
 * Fetch coord's queryable-surface catalog — the authoritative, fleet-global
 * index of the `coord_query_*` twin observers. Backs the "Queryable surface"
 * view: coord is the single source of truth for which observer surfaces exist
 * (the same list the agent Q&A meta-answer's `{{twin-catalog}}` token expands),
 * replacing the checked-in manifest as the primary surface list.
 *
 * Fleet-global static metadata, so it is effectively immutable across a session
 * — cached long and never refetched on focus.
 */
export function useTwinCatalog() {
  return useQuery({
    queryKey: ["digital-twin", "catalog"],
    queryFn: () => httpClient.get<TwinCatalogResponse>(CATALOG_URL),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
