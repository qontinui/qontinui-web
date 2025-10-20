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

import { useQuery } from '@tanstack/react-query'
import { authService } from '@/services/service-factory'
import {
  AdminStatsSchema,
  AdminUsersArraySchema,
  AdminProjectsArraySchema,
  parseApi,
} from '@/lib/schemas'
import type {
  AdminStats,
  AdminUserData,
  AdminProjectData,
} from '@/lib/schemas'

// Admin API base URL
const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Query keys for organizing cache
export const adminKeys = {
  all: ['admin'] as const,
  stats: () => [...adminKeys.all, 'stats'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  userList: (params?: { limit?: number; offset?: number }) => [...adminKeys.users(), params] as const,
  projects: () => [...adminKeys.all, 'projects'] as const,
  projectList: (params?: { limit?: number; offset?: number }) => [...adminKeys.projects(), params] as const,
}

// Re-export types for convenience
export type { AdminStats, AdminUserData, AdminProjectData }

/**
 * Hook to fetch admin statistics
 *
 * Features:
 * - Cached for 2 minutes (stats don't change frequently)
 * - Background refetch on window focus
 */
export function useAdminStats() {
  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: async () => {
      const apiUrl = getApiUrl()
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${apiUrl}/api/v1/admin/stats`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch admin stats')
      }

      const data = await response.json()
      return parseApi(AdminStatsSchema, data, 'admin stats')
    },
    // Keep stats cached for 2 minutes
    staleTime: 2 * 60 * 1000,
  })
}

/**
 * Hook to fetch admin user list
 *
 * @param params - Query parameters (limit, offset)
 */
export function useAdminUsers(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: adminKeys.userList(params),
    queryFn: async () => {
      const apiUrl = getApiUrl()
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      const searchParams = new URLSearchParams()
      if (params?.limit) searchParams.set('limit', params.limit.toString())
      if (params?.offset) searchParams.set('offset', params.offset.toString())

      const url = `${apiUrl}/api/v1/admin/users${searchParams.toString() ? `?${searchParams}` : ''}`

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch admin users')
      }

      const data = await response.json()
      return parseApi(AdminUsersArraySchema, data, 'admin users')
    },
    // Keep user list cached for 1 minute
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}

/**
 * Hook to fetch admin project list
 *
 * @param params - Query parameters (limit, offset)
 */
export function useAdminProjects(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: adminKeys.projectList(params),
    queryFn: async () => {
      const apiUrl = getApiUrl()
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      const searchParams = new URLSearchParams()
      if (params?.limit) searchParams.set('limit', params.limit.toString())
      if (params?.offset) searchParams.set('offset', params.offset.toString())

      const url = `${apiUrl}/api/v1/admin/projects${searchParams.toString() ? `?${searchParams}` : ''}`

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch admin projects')
      }

      const data = await response.json()
      return parseApi(AdminProjectsArraySchema, data, 'admin projects')
    },
    // Keep project list cached for 1 minute
    staleTime: 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}
