/**
 * TanStack Query hooks for admin operations
 *
 * Provides caching and state management for admin dashboard data.
 * These hooks integrate with the existing admin API endpoints.
 *
 * Example usage:
 *
 * function AdminDashboard() {
 *   const { data: stats, isLoading } = useAdminStats()
 *   const { data: users } = useAdminUsers({ limit: 10 })
 *
 *   if (isLoading) return <div>Loading...</div>
 *
 *   return (
 *     <div>
 *       <h1>Total Users: {stats?.total_users}</h1>
 *       {users?.map(user => <div key={user.id}>{user.username}</div>)}
 *     </div>
 *   )
 * }
 */

import { useQuery } from "@tanstack/react-query";
import { authService } from "@/services/service-factory";
import {
  AdminStatsSchema,
  AdminUsersArraySchema,
  AdminProjectsArraySchema,
  AdminProjectDetailsSchema,
  parseApi,
} from "@/lib/schemas";
import type {
  AdminStats,
  AdminUserData,
  AdminProjectData,
  AdminProjectDetails,
} from "@/lib/schemas";

// Admin API base URL - always use empty string for relative URLs through Next.js proxy
// This ensures cookies are properly forwarded for authentication
const getApiUrl = () => "";

// Query keys for organizing cache
export const adminKeys = {
  all: ["admin"] as const,
  stats: () => [...adminKeys.all, "stats"] as const,
  users: () => [...adminKeys.all, "users"] as const,
  userList: (params?: { limit?: number; offset?: number }) =>
    [...adminKeys.users(), params] as const,
  projects: () => [...adminKeys.all, "projects"] as const,
  projectList: (params?: { limit?: number; offset?: number }) =>
    [...adminKeys.projects(), params] as const,
  projectDetail: (projectId: string) =>
    [...adminKeys.projects(), projectId] as const,
};

// Re-export types for convenience
export type {
  AdminStats,
  AdminUserData,
  AdminProjectData,
  AdminProjectDetails,
};

/**
 * Hook to fetch admin statistics
 *
 * Features:
 * - Cached for 2 minutes (stats don't change frequently)
 * - Background refetch on window focus
 * - Only runs when authenticated (uses HttpOnly cookies)
 */
export function useAdminStats() {
  // Check if user is authenticated (using hasValidToken which checks auth state)
  const isAuthenticated = authService.tokenManager.hasValidToken();

  console.log("[useAdminStats] isAuthenticated:", isAuthenticated);

  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: async () => {
      const apiUrl = getApiUrl();
      const url = `${apiUrl}/api/v1/admin/stats`;

      console.log("[useAdminStats] Fetching from:", url);

      // Use credentials: 'include' to send HttpOnly cookies for authentication
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      console.log(
        "[useAdminStats] Response:",
        response.status,
        response.statusText
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error("[useAdminStats] Error:", errorText);
        throw new Error(
          `Failed to fetch admin stats: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return parseApi(AdminStatsSchema, data, "admin stats");
    },
    // Only run when authenticated
    enabled: isAuthenticated,
    // Keep stats cached for 2 minutes
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch admin user list
 *
 * @param params - Query parameters (limit, offset)
 */
export function useAdminUsers(params?: { limit?: number; offset?: number }) {
  const isAuthenticated = authService.tokenManager.hasValidToken();

  console.log("[useAdminUsers] isAuthenticated:", isAuthenticated);

  return useQuery({
    queryKey: adminKeys.userList(params),
    queryFn: async () => {
      const apiUrl = getApiUrl();

      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set("limit", params.limit.toString());
      if (params?.offset) searchParams.set("offset", params.offset.toString());

      const url = `${apiUrl}/api/v1/admin/users${searchParams.toString() ? `?${searchParams}` : ""}`;

      console.log("[useAdminUsers] Fetching from:", url);

      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      console.log(
        "[useAdminUsers] Response:",
        response.status,
        response.statusText
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error("[useAdminUsers] Error:", errorText);
        throw new Error(
          `Failed to fetch admin users: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return parseApi(AdminUsersArraySchema, data, "admin users");
    },
    // Only run when authenticated
    enabled: isAuthenticated,
    // Keep user list cached for 1 minute
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch admin project list
 *
 * @param params - Query parameters (limit, offset)
 */
export function useAdminProjects(params?: { limit?: number; offset?: number }) {
  const isAuthenticated = authService.tokenManager.hasValidToken();

  return useQuery({
    queryKey: adminKeys.projectList(params),
    queryFn: async () => {
      const apiUrl = getApiUrl();

      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set("limit", params.limit.toString());
      if (params?.offset) searchParams.set("offset", params.offset.toString());

      const url = `${apiUrl}/api/v1/admin/projects${searchParams.toString() ? `?${searchParams}` : ""}`;

      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to fetch admin projects: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return parseApi(AdminProjectsArraySchema, data, "admin projects");
    },
    // Only run when authenticated
    enabled: isAuthenticated,
    // Keep project list cached for 1 minute
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch detailed project information
 *
 * @param projectId - The project ID to fetch
 * @param enabled - Whether to enable the query (default: true)
 */
export function useAdminProjectDetails(
  projectId: string | null,
  enabled: boolean = true
) {
  const isAuthenticated = authService.tokenManager.hasValidToken();

  return useQuery({
    queryKey: adminKeys.projectDetail(projectId || ""),
    queryFn: async () => {
      if (!projectId) {
        throw new Error("Project ID is required");
      }

      const apiUrl = getApiUrl();

      const response = await fetch(
        `${apiUrl}/api/v1/admin/projects/${projectId}`,
        {
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to fetch project details: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return parseApi(AdminProjectDetailsSchema, data, "admin project details");
    },
    // Only run when authenticated and have projectId
    enabled: enabled && !!projectId && isAuthenticated,
    // Keep project details cached for 2 minutes
    staleTime: 2 * 60 * 1000,
  });
}
