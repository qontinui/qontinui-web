"use client";

import { useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";

import { lookupUsers, type UserSummary } from "@/lib/api/strategy";

/**
 * Frontend cache for `<MentionMarker>` UUID → username resolution.
 *
 * Strategy: lazy + batched. On `<ThreadView>` mount we collect every
 * UUID referenced in the loaded posts, prime the cache with one
 * `lookupUsers` call, then individual `<MentionMarker>` renders hit
 * the cache synchronously. Cache misses (e.g. a freshly-created post
 * with a UUID the bulk-fetch didn't see) fall back to `@?` until
 * the next bulk refresh.
 *
 * Keyed by a single React Query entry (`["strategy", "users", "cache"]`)
 * holding `Record<UUID, UserSummary>`. Mutating the entry via the
 * `prime` helper merges-in new entries without invalidating, so the
 * UI never re-renders during a benign cache prefill.
 */
export const USER_CACHE_KEY = ["strategy", "users", "cache"] as const;
type UserCacheMap = Record<string, UserSummary>;

export function useUserCache() {
  const queryClient = useQueryClient();

  const { data: cache = {} } = useQuery<UserCacheMap>({
    queryKey: USER_CACHE_KEY,
    queryFn: () => Promise.resolve({}),
    staleTime: Infinity,
    gcTime: Infinity,
    // Initial fetch is a no-op; we only ever WRITE via setQueryData.
  });

  const merge = useCallback(
    (rows: UserSummary[]) => {
      queryClient.setQueryData<UserCacheMap>(USER_CACHE_KEY, (prev) => {
        const next: UserCacheMap = { ...(prev ?? {}) };
        for (const row of rows) {
          next[row.id.toLowerCase()] = row;
        }
        return next;
      });
    },
    [queryClient]
  );

  const prime = useCallback(
    async (ids: string[]) => {
      const lower = ids.map((id) => id.toLowerCase());
      const missing = lower.filter((id) => !(id in (cache ?? {})));
      if (missing.length === 0) return;
      try {
        const rows = await lookupUsers(missing);
        merge(rows);
      } catch {
        // Silent — `@?` fallback covers the unhappy path.
      }
    },
    [cache, merge]
  );

  const get = useCallback(
    (id: string): UserSummary | undefined => cache[id.toLowerCase()],
    [cache]
  );

  return { get, prime, merge, cache };
}
