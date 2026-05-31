"use client";

/**
 * useCoPilotPreference — per-user durable opt-in for the UI Bridge AI co-pilot.
 *
 * Reads / writes ``users.preferences.ui_bridge_co_pilot_enabled`` via the
 * existing ``/api/v1/users/me/preferences`` endpoint (the same JSONB store
 * used by ``product_mode``). Default is ``false`` — the user MUST opt in
 * before the relay listener even attempts to mount.
 *
 * This is the FIRST of two gates that compose into the
 * ``enableRemoteCommands`` decision in ``lib/ui-bridge/provider.tsx``. The
 * second is the per-session consent modal (see ``useCoPilotSessionConsent``).
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const PREFERENCES_URL = `${ApiConfig.API_BASE_URL}/api/v1/users/me/preferences`;

/** React Query key — exported for tests + cross-hook invalidation. */
export const CO_PILOT_PREFERENCE_QUERY_KEY = [
  "users",
  "me",
  "preferences",
] as const;

interface UserPreferencesShape {
  product_mode?: "ai" | "visual" | null;
  ui_bridge_co_pilot_enabled?: boolean;
  [key: string]: unknown;
}

export interface UseCoPilotPreference {
  /** Is the user-level preference on? `false` while loading / on error. */
  enabled: boolean;
  /** True while the initial GET is in flight. */
  isLoading: boolean;
  /** True while the mutate is in flight. */
  isMutating: boolean;
  /**
   * Persist the new preference. Optimistically updates the cached value so
   * the UI flips instantly; on server failure the cache is rolled back.
   */
  mutate: (next: boolean) => Promise<void>;
}

async function fetchPreferences(): Promise<UserPreferencesShape> {
  const res = await httpClient.fetch(PREFERENCES_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to load preferences: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as UserPreferencesShape;
}

async function persistPreference(
  next: boolean
): Promise<UserPreferencesShape> {
  const res = await httpClient.fetch(PREFERENCES_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ui_bridge_co_pilot_enabled: next }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to update co-pilot preference: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as UserPreferencesShape;
}

export function useCoPilotPreference(): UseCoPilotPreference {
  const queryClient = useQueryClient();

  const query = useQuery<UserPreferencesShape>({
    queryKey: CO_PILOT_PREFERENCE_QUERY_KEY,
    queryFn: fetchPreferences,
    // No retry on preference reads — a 401 here means the user is logged
    // out and the consent layer is moot. The provider falls back to
    // ``enabled: false`` anyway.
    retry: false,
    // Preferences are durable. Refetch when the window regains focus so a
    // change made in another tab is reflected; the storage event in
    // useCoPilotSessionConsent handles the per-session decision.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: persistPreference,
    onMutate: async (next) => {
      await queryClient.cancelQueries({
        queryKey: CO_PILOT_PREFERENCE_QUERY_KEY,
      });
      const previous = queryClient.getQueryData<UserPreferencesShape>(
        CO_PILOT_PREFERENCE_QUERY_KEY
      );
      queryClient.setQueryData<UserPreferencesShape>(
        CO_PILOT_PREFERENCE_QUERY_KEY,
        {
          ...(previous ?? {}),
          ui_bridge_co_pilot_enabled: next,
        }
      );
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          CO_PILOT_PREFERENCE_QUERY_KEY,
          context.previous
        );
      }
    },
    onSettled: (result) => {
      if (result) {
        queryClient.setQueryData(CO_PILOT_PREFERENCE_QUERY_KEY, result);
      } else {
        queryClient.invalidateQueries({
          queryKey: CO_PILOT_PREFERENCE_QUERY_KEY,
        });
      }
    },
  });

  return {
    enabled: query.data?.ui_bridge_co_pilot_enabled === true,
    isLoading: query.isLoading,
    isMutating: mutation.isPending,
    mutate: async (next: boolean) => {
      await mutation.mutateAsync(next);
    },
  };
}
