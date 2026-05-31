"use client";

/**
 * useIdentities — react-query access to the caller's "Connected accounts"
 * (cross-IdP identity links).
 *
 * Mirrors the data-fetching pattern used elsewhere in settings
 * (`@tanstack/react-query` + the shared `httpClient`-backed API layer). The
 * query is the source of truth for the list; `unlink` is a mutation that
 * invalidates/replaces the cache on success. Linking happens out-of-band in
 * the OAuth callback (a full-page redirect round-trip), so it is not a
 * mutation here — the callback redirects back to the page, which refetches.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listIdentities,
  unlinkIdentity,
  type IdentityListResponse,
} from "@/lib/api/identities";

/** React Query key — exported for cross-surface invalidation + tests. */
export const IDENTITIES_QUERY_KEY = ["auth", "identities"] as const;

export interface UseIdentities {
  /** The linked identities (includes the synthetic native "Cognito" entry). */
  data: IdentityListResponse | undefined;
  /** True while the initial GET is in flight. */
  isLoading: boolean;
  /** A load error, if the GET failed. */
  error: Error | null;
  /** Refetch the list (after a connect round-trip lands back on the page). */
  refetch: () => void;
  /** Unlink a provider; rejects with `UnlinkIdentityError` on a 409 lockout. */
  unlink: (provider: string) => Promise<void>;
  /** Provider currently being unlinked, or null. Drives per-row spinners. */
  unlinkingProvider: string | null;
}

export function useIdentities(): UseIdentities {
  const queryClient = useQueryClient();

  const query = useQuery<IdentityListResponse, Error>({
    queryKey: IDENTITIES_QUERY_KEY,
    queryFn: listIdentities,
    // A 401 here means the session is gone — the page is auth-gated anyway, so
    // don't hammer the endpoint retrying.
    retry: false,
    staleTime: 30_000,
  });

  const mutation = useMutation<IdentityListResponse, Error, string>({
    mutationFn: (provider: string) => unlinkIdentity(provider),
    onSuccess: (result) => {
      // The DELETE returns the refreshed list — seed the cache directly so the
      // UI updates without a second round-trip.
      queryClient.setQueryData(IDENTITIES_QUERY_KEY, result);
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: IDENTITIES_QUERY_KEY });
    },
    unlink: async (provider: string) => {
      await mutation.mutateAsync(provider);
    },
    unlinkingProvider: mutation.isPending ? mutation.variables ?? null : null,
  };
}
