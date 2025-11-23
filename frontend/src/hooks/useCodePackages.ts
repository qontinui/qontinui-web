/**
 * React Query hooks for managing code packages
 *
 * Provides automatic caching, refetching, and optimistic updates for
 * code package data in the Community Code Marketplace.
 *
 * Example usage:
 *
 * function MarketplacePage() {
 *   const { data: packages, isLoading } = usePackages({ verified_only: true })
 *   const installPackage = useInstallPackage()
 *
 *   if (isLoading) return <div>Loading...</div>
 *
 *   return (
 *     <div>
 *       {packages?.packages.map(pkg => (
 *         <PackageCard
 *           key={pkg.id}
 *           package={pkg}
 *           onInstall={() => installPackage.mutate({
 *             package_id: pkg.id,
 *             project_id: currentProjectId
 *           })}
 *         />
 *       ))}
 *     </div>
 *   )
 * }
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  CodePackage,
  SearchFilters,
  PackageSearchResult,
  PackageInstallation,
  PackageRating,
  CreatePackageRequest,
  UpdatePackageRequest,
  PublishVersionRequest,
  InstallPackageRequest,
  RatePackageRequest,
  ReportPackageRequest,
} from '@/types/code-packages'

// Query keys for organizing cache
export const packageKeys = {
  all: ['packages'] as const,
  lists: () => [...packageKeys.all, 'list'] as const,
  list: (filters?: SearchFilters) => [...packageKeys.lists(), { filters }] as const,
  details: () => [...packageKeys.all, 'detail'] as const,
  detail: (id: string) => [...packageKeys.details(), id] as const,
  popular: () => [...packageKeys.all, 'popular'] as const,
  myPackages: () => [...packageKeys.all, 'my-packages'] as const,
  installed: (projectId: string) => [...packageKeys.all, 'installed', projectId] as const,
  ratings: (packageId: string) => [...packageKeys.all, 'ratings', packageId] as const,
}

// Mock API service - Replace with actual API calls
const packageApi = {
  async searchPackages(filters?: SearchFilters): Promise<PackageSearchResult> {
    // TODO: Replace with actual API call
    // const response = await fetch('/api/v1/marketplace/packages', { ... })
    // return response.json()

    // Mock data for development
    return {
      packages: [],
      total: 0,
      page: filters?.page || 1,
      limit: filters?.limit || 20,
      total_pages: 0,
    }
  },

  async getPackage(id: string): Promise<CodePackage> {
    // TODO: Replace with actual API call
    // const response = await fetch(`/api/v1/marketplace/packages/${id}`)
    // return response.json()

    throw new Error('Package not found')
  },

  async getPopularPackages(): Promise<CodePackage[]> {
    // TODO: Replace with actual API call
    return []
  },

  async getMyPackages(): Promise<CodePackage[]> {
    // TODO: Replace with actual API call
    return []
  },

  async getInstalledPackages(projectId: string): Promise<PackageInstallation[]> {
    // TODO: Replace with actual API call
    return []
  },

  async createPackage(data: CreatePackageRequest): Promise<CodePackage> {
    // TODO: Replace with actual API call
    throw new Error('Not implemented')
  },

  async updatePackage(id: string, data: UpdatePackageRequest): Promise<CodePackage> {
    // TODO: Replace with actual API call
    throw new Error('Not implemented')
  },

  async publishVersion(packageId: string, data: PublishVersionRequest): Promise<CodePackage> {
    // TODO: Replace with actual API call
    throw new Error('Not implemented')
  },

  async installPackage(data: InstallPackageRequest): Promise<PackageInstallation> {
    // TODO: Replace with actual API call
    throw new Error('Not implemented')
  },

  async uninstallPackage(installationId: string): Promise<void> {
    // TODO: Replace with actual API call
  },

  async getRatings(packageId: string): Promise<PackageRating[]> {
    // TODO: Replace with actual API call
    return []
  },

  async ratePackage(data: RatePackageRequest): Promise<PackageRating> {
    // TODO: Replace with actual API call
    throw new Error('Not implemented')
  },

  async reportPackage(data: ReportPackageRequest): Promise<void> {
    // TODO: Replace with actual API call
  },

  async deletePackage(id: string): Promise<void> {
    // TODO: Replace with actual API call
  },
}

/**
 * Hook to search and filter packages
 *
 * Features:
 * - Automatic caching
 * - Background refetching when data becomes stale
 * - Maintains previous data during refetch (prevents loading flicker)
 *
 * @param filters - Search and filter criteria
 */
export function usePackages(filters?: SearchFilters) {
  return useQuery({
    queryKey: packageKeys.list(filters),
    queryFn: () => packageApi.searchPackages(filters),
    placeholderData: (previousData) => previousData,
    staleTime: 30000, // Consider data fresh for 30 seconds
  })
}

/**
 * Hook to fetch a single package by ID
 *
 * @param id - Package ID to fetch
 * @param enabled - Whether to run the query (defaults to true)
 */
export function usePackageDetails(id: string, enabled = true) {
  return useQuery({
    queryKey: packageKeys.detail(id),
    queryFn: () => packageApi.getPackage(id),
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
    staleTime: 60000, // Details stay fresh for 1 minute
  })
}

/**
 * Hook to fetch popular/trending packages
 *
 * Features:
 * - Fetches top packages by downloads, rating, or trending score
 * - Useful for homepage/featured sections
 */
export function usePopularPackages() {
  return useQuery({
    queryKey: packageKeys.popular(),
    queryFn: () => packageApi.getPopularPackages(),
    placeholderData: (previousData) => previousData,
    staleTime: 300000, // Stay fresh for 5 minutes
  })
}

/**
 * Hook to fetch packages published by the current user
 *
 * Features:
 * - Lists all packages created by the authenticated user
 * - Useful for "My Packages" page
 */
export function useMyPackages() {
  return useQuery({
    queryKey: packageKeys.myPackages(),
    queryFn: () => packageApi.getMyPackages(),
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  })
}

/**
 * Hook to fetch packages installed in a specific project
 *
 * @param projectId - Project ID to check installations
 * @param enabled - Whether to run the query
 */
export function useInstalledPackages(projectId: string, enabled = true) {
  return useQuery({
    queryKey: packageKeys.installed(projectId),
    queryFn: () => packageApi.getInstalledPackages(projectId),
    enabled: enabled && !!projectId,
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  })
}

/**
 * Hook to fetch ratings for a package
 *
 * @param packageId - Package ID to fetch ratings for
 * @param enabled - Whether to run the query
 */
export function usePackageRatings(packageId: string, enabled = true) {
  return useQuery({
    queryKey: packageKeys.ratings(packageId),
    queryFn: () => packageApi.getRatings(packageId),
    enabled: enabled && !!packageId,
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
  })
}

/**
 * Hook to create a new package
 *
 * Features:
 * - Automatically invalidates and refetches package lists on success
 * - Returns mutation state (isLoading, error, etc.)
 */
export function useCreatePackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreatePackageRequest) => packageApi.createPackage(data),
    onSuccess: (newPackage) => {
      // Invalidate lists to show new package
      queryClient.invalidateQueries({ queryKey: packageKeys.lists() })
      queryClient.invalidateQueries({ queryKey: packageKeys.myPackages() })

      // Set the new package in cache
      queryClient.setQueryData(packageKeys.detail(newPackage.id), newPackage)
    },
  })
}

/**
 * Hook to update an existing package
 *
 * Features:
 * - Optimistic updates for immediate UI feedback
 * - Automatic rollback on error
 */
export function useUpdatePackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePackageRequest }) =>
      packageApi.updatePackage(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: packageKeys.detail(id) })

      // Snapshot previous value
      const previousPackage = queryClient.getQueryData<CodePackage>(packageKeys.detail(id))

      // Optimistically update
      if (previousPackage) {
        queryClient.setQueryData<CodePackage>(packageKeys.detail(id), {
          ...previousPackage,
          ...data,
        })
      }

      return { previousPackage, id }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousPackage) {
        queryClient.setQueryData(packageKeys.detail(context.id), context.previousPackage)
      }
    },
    onSuccess: (_data, { id }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: packageKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: packageKeys.lists() })
      queryClient.invalidateQueries({ queryKey: packageKeys.myPackages() })
    },
  })
}

/**
 * Hook to publish a new version of a package
 *
 * Features:
 * - Publishes new version with code, readme, changelog
 * - Triggers security scan automatically
 */
export function usePublishVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ packageId, data }: { packageId: string; data: PublishVersionRequest }) =>
      packageApi.publishVersion(packageId, data),
    onSuccess: (updatedPackage, { packageId }) => {
      // Update package details with new version
      queryClient.setQueryData(packageKeys.detail(packageId), updatedPackage)
      queryClient.invalidateQueries({ queryKey: packageKeys.lists() })
      queryClient.invalidateQueries({ queryKey: packageKeys.myPackages() })
    },
  })
}

/**
 * Hook to install a package into a project
 *
 * Features:
 * - Installs package and dependencies
 * - Updates installed packages list
 * - Tracks installation status
 */
export function useInstallPackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: InstallPackageRequest) => packageApi.installPackage(data),
    onSuccess: (installation, variables) => {
      // Update installed packages list
      queryClient.invalidateQueries({ queryKey: packageKeys.installed(variables.project_id) })

      // Update package stats (download count)
      queryClient.invalidateQueries({ queryKey: packageKeys.detail(variables.package_id) })
    },
  })
}

/**
 * Hook to uninstall a package from a project
 *
 * Features:
 * - Removes package from project
 * - Optimistic removal from UI
 */
export function useUninstallPackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (installationId: string) => packageApi.uninstallPackage(installationId),
    onSuccess: (_data, _variables, context: any) => {
      // Invalidate all installed package queries
      queryClient.invalidateQueries({ queryKey: packageKeys.all })
    },
  })
}

/**
 * Hook to rate/review a package
 *
 * Features:
 * - Submit rating (1-5 stars) and optional review
 * - Updates package rating statistics
 */
export function useRatePackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: RatePackageRequest) => packageApi.ratePackage(data),
    onSuccess: (newRating, variables) => {
      // Invalidate ratings list
      queryClient.invalidateQueries({ queryKey: packageKeys.ratings(variables.package_id) })

      // Invalidate package details to update average rating
      queryClient.invalidateQueries({ queryKey: packageKeys.detail(variables.package_id) })
    },
  })
}

/**
 * Hook to report a package for violations
 *
 * Features:
 * - Report malicious code, copyright violations, spam, etc.
 * - Triggers review by staff
 */
export function useReportPackage() {
  return useMutation({
    mutationFn: (data: ReportPackageRequest) => packageApi.reportPackage(data),
  })
}

/**
 * Hook to delete a package
 *
 * Features:
 * - Only available to package owner or staff
 * - Removes package and all versions
 */
export function useDeletePackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => packageApi.deletePackage(id),
    onSuccess: () => {
      // Invalidate all package queries
      queryClient.invalidateQueries({ queryKey: packageKeys.lists() })
      queryClient.invalidateQueries({ queryKey: packageKeys.myPackages() })
    },
  })
}
