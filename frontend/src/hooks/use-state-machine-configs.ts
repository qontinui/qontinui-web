/**
 * TanStack Query hooks for state machine config persistence.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { stateMachineConfigService } from "@/services/service-factory";
import type {
  StateMachineConfigCreateData,
  StateMachineConfigUpdateData,
} from "@/services/state-machine-config-service";

export const smConfigKeys = {
  all: ["state-machine-configs"] as const,
  lists: () => [...smConfigKeys.all, "list"] as const,
  list: (projectId: string) => [...smConfigKeys.lists(), projectId] as const,
  details: () => [...smConfigKeys.all, "detail"] as const,
  detail: (projectId: string, configId: string) =>
    [...smConfigKeys.details(), projectId, configId] as const,
};

/** List all configs for a project */
export function useStateMachineConfigs(projectId: string | null) {
  return useQuery({
    queryKey: smConfigKeys.list(projectId ?? ""),
    queryFn: () => stateMachineConfigService.list(projectId!),
    enabled: !!projectId,
    placeholderData: (prev) => prev,
  });
}

/** Get a single config by ID */
export function useStateMachineConfig(
  projectId: string | null,
  configId: string | null
) {
  return useQuery({
    queryKey: smConfigKeys.detail(projectId ?? "", configId ?? ""),
    queryFn: () => stateMachineConfigService.get(projectId!, configId!),
    enabled: !!projectId && !!configId,
  });
}

/** Create or update a config */
export function useSaveStateMachineConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      projectId: string;
      configId?: string | null;
      data: StateMachineConfigCreateData | StateMachineConfigUpdateData;
    }) => {
      if (params.configId) {
        return stateMachineConfigService.update(
          params.projectId,
          params.configId,
          params.data as StateMachineConfigUpdateData
        );
      }
      return stateMachineConfigService.create(
        params.projectId,
        params.data as StateMachineConfigCreateData
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: smConfigKeys.list(variables.projectId),
      });
      if (variables.configId) {
        queryClient.invalidateQueries({
          queryKey: smConfigKeys.detail(
            variables.projectId,
            variables.configId
          ),
        });
      }
    },
  });
}

/** Delete a config */
export function useDeleteStateMachineConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { projectId: string; configId: string }) => {
      await stateMachineConfigService.delete(params.projectId, params.configId);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: smConfigKeys.list(variables.projectId),
      });
    },
  });
}
