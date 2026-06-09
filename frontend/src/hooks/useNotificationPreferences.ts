"use client";

/**
 * useNotificationPreferences -- per-user durable notification delivery prefs.
 *
 * Reads/writes the per-type boolean columns on NotificationPreferences via:
 *   GET  /api/v1/notifications/preferences
 *   PUT  /api/v1/notifications/preferences
 *
 * Optimistic updates: the local cache flips immediately on save; on server
 * failure the cache is rolled back and the error is re-thrown so the caller
 * can show a toast / error state.
 *
 * Re-fetches when the window regains focus so changes made in another tab
 * or device are reflected.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const PREFS_URL = `${ApiConfig.API_BASE_URL}/api/v1/notifications/preferences`;

/** React Query key -- exported for tests + cross-hook invalidation. */
export const NOTIFICATION_PREFS_QUERY_KEY = [
  "notifications",
  "preferences",
] as const;

/**
 * The full shape returned by GET /api/v1/notifications/preferences.
 * Mirrors backend NotificationPreferencesResponse (all booleans default true).
 */
export interface NotificationPreferencesShape {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;

  // Email
  email_mentions: boolean;
  email_comments: boolean;
  email_shares: boolean;
  email_replies: boolean;
  email_team_invites: boolean;
  email_gate_action: boolean;

  // In-app
  in_app_mentions: boolean;
  in_app_comments: boolean;
  in_app_shares: boolean;
  in_app_replies: boolean;
  in_app_team_invites: boolean;
  in_app_project_updates: boolean;
  in_app_gate_action: boolean;
}

/**
 * Partial update payload -- only the fields being changed need to be sent.
 * Maps to backend NotificationPreferencesUpdate (all optional booleans).
 */
export type NotificationPreferencesUpdate = Partial<
  Omit<NotificationPreferencesShape, "id" | "user_id" | "created_at" | "updated_at">
>;

async function fetchPreferences(): Promise<NotificationPreferencesShape> {
  const res = await httpClient.fetch(PREFS_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to load notification preferences: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as NotificationPreferencesShape;
}

async function persistPreferences(
  update: NotificationPreferencesUpdate
): Promise<NotificationPreferencesShape> {
  const res = await httpClient.fetch(PREFS_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to update notification preferences: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as NotificationPreferencesShape;
}

export interface UseNotificationPreferences {
  /** Full preferences object; undefined while loading or on error. */
  preferences: NotificationPreferencesShape | undefined;
  /** True while the initial GET is in flight. */
  isLoading: boolean;
  /** Non-null when the GET fails. */
  error: Error | null;
  /** True while a PUT is in flight. */
  isMutating: boolean;
  /**
   * Persist a partial update. Optimistically updates the cache so the UI
   * flips instantly; rolls back on server failure and re-throws the error.
   */
  save: (update: NotificationPreferencesUpdate) => Promise<void>;
}

export function useNotificationPreferences(): UseNotificationPreferences {
  const queryClient = useQueryClient();

  const query = useQuery<NotificationPreferencesShape, Error>({
    queryKey: NOTIFICATION_PREFS_QUERY_KEY,
    queryFn: fetchPreferences,
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const mutation = useMutation<
    NotificationPreferencesShape,
    Error,
    NotificationPreferencesUpdate,
    { previous: NotificationPreferencesShape | undefined }
  >({
    mutationFn: persistPreferences,
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_PREFS_QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationPreferencesShape>(
        NOTIFICATION_PREFS_QUERY_KEY
      );
      queryClient.setQueryData<NotificationPreferencesShape>(
        NOTIFICATION_PREFS_QUERY_KEY,
        previous ? { ...previous, ...update } : undefined
      );
      return { previous };
    },
    onError: (_err, _update, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(NOTIFICATION_PREFS_QUERY_KEY, context.previous);
      }
    },
    onSettled: (result) => {
      if (result) {
        queryClient.setQueryData(NOTIFICATION_PREFS_QUERY_KEY, result);
      } else {
        void queryClient.invalidateQueries({ queryKey: NOTIFICATION_PREFS_QUERY_KEY });
      }
    },
  });

  return {
    preferences: query.data,
    isLoading: query.isLoading,
    error: query.error,
    isMutating: mutation.isPending,
    save: async (update) => {
      await mutation.mutateAsync(update);
    },
  };
}
