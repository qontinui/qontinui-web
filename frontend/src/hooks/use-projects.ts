/**
 * TanStack Query hooks for managing projects
 *
 * Provides automatic caching, refetching, and optimistic updates for project data.
 * This replaces manual state management and API calls with declarative data fetching.
 *
 * Example usage:
 *
 * function ProjectList() {
 *   const { data: projects, isLoading, error } = useProjects()
 *   const createProject = useCreateProject()
 *
 *   if (isLoading) return <div>Loading...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <div>
 *       {projects?.map(project => <div key={project.id}>{project.name}</div>)}
 *       <button onClick={() => createProject.mutate({ name: 'New Project', configuration: {} })}>
 *         Create Project
 *       </button>
 *     </div>
 *   )
 * }
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectService } from "@/services/service-factory";
import { ProjectSchema, ProjectsArraySchema, parseApi } from "@/lib/schemas";
import type { Project } from "@/lib/schemas";

// Query keys for organizing cache
export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...projectKeys.lists(), { filters }] as const,
  details: () => [...projectKeys.all, "detail"] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
};

/**
 * Hook to fetch all projects for the current user
 *
 * Features:
 * - Automatic caching (fresh for 1 minute by default)
 * - Background refetching when data becomes stale
 * - Automatic retries on failure
 */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: async () => {
      try {
        const data = await projectService.getProjects();
        const parsed = parseApi(ProjectsArraySchema, data, "projects list");
        return parsed;
      } catch (error) {
        console.error("[useProjects] Error fetching projects:", error);
        throw error;
      }
    },
    // Keep previous data while fetching new data (prevents loading flicker)
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch a single project by ID
 *
 * @param id - Project ID to fetch
 * @param enabled - Whether to run the query (defaults to true)
 */
export function useProject(id: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: async () => {
      const data = await projectService.getProject(id);
      return parseApi(ProjectSchema, data, "project detail");
    },
    enabled: enabled && !!id, // Only fetch if enabled and ID is valid
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to create a new project
 *
 * Features:
 * - Automatically invalidates and refetches project list on success
 * - Returns mutation state (isLoading, error, etc.)
 */
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      configuration: { [key: string]: unknown };
    }) => {
      const result = await projectService.createProject(data);
      return parseApi(ProjectSchema, result, "create project");
    },
    onSuccess: (newProject) => {
      // Invalidate and refetch projects list
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });

      // Set the new project in cache so it's immediately available
      queryClient.setQueryData(projectKeys.detail(newProject.id), newProject);
    },
  });
}

/**
 * Hook to update an existing project
 *
 * Features:
 * - Optimistic updates (UI updates immediately before server confirms)
 * - Automatic rollback on error
 * - Invalidates related queries on success
 */
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Project>;
    }) => {
      const result = await projectService.updateProject(id, data);
      return parseApi(ProjectSchema, result, "update project");
    },
    // Optimistic update
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.detail(id) });

      // Snapshot previous value
      const previousProject = queryClient.getQueryData<Project>(
        projectKeys.detail(id)
      );

      // Optimistically update
      if (previousProject) {
        queryClient.setQueryData<Project>(projectKeys.detail(id), {
          ...previousProject,
          ...data,
        });
      }

      // Return context with snapshot
      return { previousProject, id };
    },
    // Rollback on error
    onError: (_err, _variables, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(
          projectKeys.detail(context.id),
          context.previousProject
        );
      }
    },
    // Refetch on success
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

/**
 * Hook to delete a project
 *
 * Features:
 * - Optimistic removal from list
 * - Automatic rollback on error
 * - Invalidates related queries on success
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => projectService.deleteProject(id),
    // Optimistic update
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });

      // Snapshot previous value
      const previousProjects = queryClient.getQueryData<Project[]>(
        projectKeys.lists()
      );

      // Optimistically remove from list
      if (previousProjects) {
        queryClient.setQueryData<Project[]>(
          projectKeys.lists(),
          previousProjects.filter((project) => project.id !== id)
        );
      }

      // Return context with snapshot
      return { previousProjects };
    },
    // Rollback on error
    onError: (_err, _id, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    // Refetch on success
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}
