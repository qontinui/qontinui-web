/**
 * TanStack Query hooks for managing discoveries
 *
 * Provides automatic caching, refetching, and optimistic updates for discovery data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { discoveriesService } from "@/services/service-factory";
import type {
  Discovery,
  DiscoveryFilters,
  DiscoveriesResponse,
  PendingCountResponse,
} from "@/types/discoveries";

// Query keys for organizing cache
export const discoveryKeys = {
  all: ["discoveries"] as const,
  lists: () => [...discoveryKeys.all, "list"] as const,
  list: (filters?: DiscoveryFilters) =>
    [...discoveryKeys.lists(), { filters }] as const,
  details: () => [...discoveryKeys.all, "detail"] as const,
  detail: (id: string) => [...discoveryKeys.details(), id] as const,
  pendingCount: () => [...discoveryKeys.all, "pendingCount"] as const,
};

/**
 * Hook to fetch discoveries with optional filters
 */
export function useDiscoveries(filters: DiscoveryFilters = {}) {
  return useQuery({
    queryKey: discoveryKeys.list(filters),
    queryFn: async (): Promise<DiscoveriesResponse> => {
      try {
        const data = await discoveriesService.getDiscoveries(filters);
        return data;
      } catch (error) {
        console.error("[useDiscoveries] Error fetching discoveries:", error);
        throw error;
      }
    },
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch a single discovery by ID
 */
export function useDiscovery(id: string, enabled = true) {
  return useQuery({
    queryKey: discoveryKeys.detail(id),
    queryFn: async (): Promise<Discovery> => {
      const data = await discoveriesService.getDiscovery(id);
      return data;
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to accept a discovery
 */
export function useAcceptDiscovery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      notes,
    }: {
      id: string;
      notes?: string;
    }): Promise<Discovery> => {
      return discoveriesService.acceptDiscovery(id, notes);
    },
    onSuccess: (updatedDiscovery) => {
      // Update the individual discovery in cache
      queryClient.setQueryData(
        discoveryKeys.detail(updatedDiscovery.id),
        updatedDiscovery
      );

      // Invalidate all lists to refresh counts and filtering
      queryClient.invalidateQueries({ queryKey: discoveryKeys.lists() });

      // Invalidate pending count
      queryClient.invalidateQueries({ queryKey: discoveryKeys.pendingCount() });
    },
  });
}

/**
 * Hook to reject a discovery
 */
export function useRejectDiscovery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      notes,
    }: {
      id: string;
      notes?: string;
    }): Promise<Discovery> => {
      return discoveriesService.rejectDiscovery(id, notes);
    },
    onSuccess: (updatedDiscovery) => {
      // Update the individual discovery in cache
      queryClient.setQueryData(
        discoveryKeys.detail(updatedDiscovery.id),
        updatedDiscovery
      );

      // Invalidate all lists to refresh counts and filtering
      queryClient.invalidateQueries({ queryKey: discoveryKeys.lists() });

      // Invalidate pending count
      queryClient.invalidateQueries({ queryKey: discoveryKeys.pendingCount() });
    },
  });
}

/**
 * Hook to get the count of pending discoveries
 */
export function usePendingDiscoveriesCount() {
  return useQuery({
    queryKey: discoveryKeys.pendingCount(),
    queryFn: async (): Promise<PendingCountResponse> => {
      try {
        const data = await discoveriesService.getPendingCount();
        return data;
      } catch (error) {
        console.error(
          "[usePendingDiscoveriesCount] Error fetching pending count:",
          error
        );
        throw error;
      }
    },
    // Refresh pending count every 30 seconds
    refetchInterval: 30000,
  });
}
