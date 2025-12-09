/**
 * TanStack Query hooks for managing extractions
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { extractionService } from "@/services/service-factory";
import type {
  ExtractionSession,
  ExtractionSessionCreate,
} from "@/services/extraction-service";

// Query keys for organizing cache
export const extractionKeys = {
  all: ["extractions"] as const,
  lists: () => [...extractionKeys.all, "list"] as const,
  list: (projectId: string) => [...extractionKeys.lists(), projectId] as const,
  details: () => [...extractionKeys.all, "detail"] as const,
  detail: (id: string) => [...extractionKeys.details(), id] as const,
};

/**
 * Hook to fetch all extractions for a project
 */
export function useExtractions(projectId: string, enabled = true) {
  return useQuery({
    queryKey: extractionKeys.list(projectId),
    queryFn: async () => {
      try {
        const data = await extractionService.getExtractions(projectId);
        return data;
      } catch (error) {
        console.error("[useExtractions] Error fetching extractions:", error);
        throw error;
      }
    },
    enabled: enabled && !!projectId,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to fetch a single extraction by ID
 */
export function useExtraction(id: string, enabled = true) {
  return useQuery({
    queryKey: extractionKeys.detail(id),
    queryFn: async () => {
      const data = await extractionService.getExtraction(id);
      return data;
    },
    enabled: enabled && !!id,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to create a new extraction
 */
export function useCreateExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      data,
    }: {
      projectId: string;
      data: ExtractionSessionCreate;
    }) => {
      const result = await extractionService.createExtraction(projectId, data);
      return result;
    },
    onSuccess: (newExtraction, { projectId }) => {
      // Invalidate and refetch extractions list for this project
      queryClient.invalidateQueries({
        queryKey: extractionKeys.list(projectId),
      });

      // Set the new extraction in cache
      queryClient.setQueryData(
        extractionKeys.detail(newExtraction.id),
        newExtraction
      );
    },
  });
}

/**
 * Hook to delete an extraction
 */
export function useDeleteExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      extractionId,
      projectId,
    }: {
      extractionId: string;
      projectId: string;
    }) => {
      await extractionService.deleteExtraction(extractionId);
      return { extractionId, projectId };
    },
    onMutate: async ({ extractionId, projectId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: extractionKeys.list(projectId),
      });

      // Snapshot previous value
      const previousExtractions = queryClient.getQueryData<ExtractionSession[]>(
        extractionKeys.list(projectId)
      );

      // Optimistically remove from list
      if (previousExtractions) {
        queryClient.setQueryData<ExtractionSession[]>(
          extractionKeys.list(projectId),
          previousExtractions.filter((ext) => ext.id !== extractionId)
        );
      }

      return { previousExtractions, projectId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousExtractions && context?.projectId) {
        queryClient.setQueryData(
          extractionKeys.list(context.projectId),
          context.previousExtractions
        );
      }
    },
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: extractionKeys.list(projectId),
      });
    },
  });
}
