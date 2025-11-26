/**
 * useGlobalVariables Hook
 *
 * React Query hook for managing global variables with CRUD operations,
 * caching, and optimistic updates.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { toast } from 'sonner';
import { authService } from '@/services/service-factory';
import type {
  GlobalVariable,
  CreateVariableRequest,
  UpdateVariableRequest,
} from '@/types/variables';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Get axios config with auth headers
 */
const getAuthConfig = () => {
  const accessToken = authService.tokenManager.getAccessToken();
  return {
    headers: {
      'Authorization': accessToken ? `Bearer ${accessToken}` : '',
      'Content-Type': 'application/json',
    },
  };
};

interface UseGlobalVariablesOptions {
  projectId: string | number;
  enabled?: boolean;
}

interface UseGlobalVariablesReturn {
  variables: GlobalVariable[];
  isLoading: boolean;
  error: Error | null;
  createVariable: (data: CreateVariableRequest) => Promise<void>;
  updateVariable: (name: string, data: UpdateVariableRequest) => Promise<void>;
  deleteVariable: (name: string) => Promise<void>;
  deleteMultiple: (names: string[]) => Promise<void>;
  refetch: () => void;
}

/**
 * Fetch global variables for a project
 */
const fetchGlobalVariables = async (
  projectId: string | number
): Promise<GlobalVariable[]> => {
  const response = await axios.get(
    `${API_BASE_URL}/api/v1/variables/global`,
    {
      params: { project_id: projectId },
      ...getAuthConfig(),
    }
  );
  // The API returns { variables: [...], total: number }
  return response.data.variables || response.data;
};

/**
 * Create a new global variable
 */
const createGlobalVariable = async (
  projectId: string | number,
  data: CreateVariableRequest
): Promise<GlobalVariable> => {
  const config = getAuthConfig();
  const response = await axios.post(
    `${API_BASE_URL}/api/v1/variables/global`,
    data,
    {
      params: { project_id: projectId },
      headers: config.headers,
    }
  );
  return response.data;
};

/**
 * Update an existing global variable
 */
const updateGlobalVariable = async (
  projectId: string | number,
  name: string,
  data: UpdateVariableRequest
): Promise<GlobalVariable> => {
  const config = getAuthConfig();
  const response = await axios.put(
    `${API_BASE_URL}/api/v1/variables/global/${encodeURIComponent(name)}`,
    data,
    {
      params: { project_id: projectId },
      headers: config.headers,
    }
  );
  return response.data;
};

/**
 * Delete a global variable
 */
const deleteGlobalVariable = async (
  projectId: string | number,
  name: string
): Promise<void> => {
  const config = getAuthConfig();
  await axios.delete(
    `${API_BASE_URL}/api/v1/variables/global/${encodeURIComponent(name)}`,
    {
      params: { project_id: projectId },
      headers: config.headers,
    }
  );
};

/**
 * Hook for managing global variables
 */
export function useGlobalVariables({
  projectId,
  enabled = true,
}: UseGlobalVariablesOptions): UseGlobalVariablesReturn {
  const queryClient = useQueryClient();
  const queryKey = ['globalVariables', projectId];

  // Fetch variables
  const { data, isLoading, error, refetch } = useQuery<GlobalVariable[], Error>({
    queryKey,
    queryFn: () => fetchGlobalVariables(projectId),
    enabled: enabled && !!projectId,
    staleTime: 30000, // 30 seconds
  });

  // Create variable mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateVariableRequest) =>
      createGlobalVariable(projectId, data),
    onMutate: async (newVariable) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousVariables = queryClient.getQueryData<GlobalVariable[]>(queryKey);

      // Optimistically update
      queryClient.setQueryData<GlobalVariable[]>(queryKey, (old = []) => [
        ...old,
        {
          ...newVariable,
          type: detectVariableType(newVariable.value),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as GlobalVariable,
      ]);

      return { previousVariables };
    },
    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previousVariables) {
        queryClient.setQueryData(queryKey, context.previousVariables);
      }
      toast.error(`Failed to create variable: ${error.message}`);
    },
    onSuccess: () => {
      toast.success('Variable created successfully');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Update variable mutation
  const updateMutation = useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateVariableRequest }) =>
      updateGlobalVariable(projectId, name, data),
    onMutate: async ({ name, data }) => {
      await queryClient.cancelQueries({ queryKey });

      const previousVariables = queryClient.getQueryData<GlobalVariable[]>(queryKey);

      queryClient.setQueryData<GlobalVariable[]>(queryKey, (old = []) =>
        old.map((v) =>
          v.name === name
            ? {
                ...v,
                value: data.value,
                description: data.description ?? v.description,
                type: detectVariableType(data.value),
                updated_at: new Date().toISOString(),
              }
            : v
        )
      );

      return { previousVariables };
    },
    onError: (error, _variables, context) => {
      if (context?.previousVariables) {
        queryClient.setQueryData(queryKey, context.previousVariables);
      }
      toast.error(`Failed to update variable: ${error.message}`);
    },
    onSuccess: () => {
      toast.success('Variable updated successfully');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Delete variable mutation
  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteGlobalVariable(projectId, name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey });

      const previousVariables = queryClient.getQueryData<GlobalVariable[]>(queryKey);

      queryClient.setQueryData<GlobalVariable[]>(queryKey, (old = []) =>
        old.filter((v) => v.name !== name)
      );

      return { previousVariables };
    },
    onError: (error, _variables, context) => {
      if (context?.previousVariables) {
        queryClient.setQueryData(queryKey, context.previousVariables);
      }
      toast.error(`Failed to delete variable: ${error.message}`);
    },
    onSuccess: () => {
      toast.success('Variable deleted successfully');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Delete multiple variables
  const deleteMultipleMutation = useMutation({
    mutationFn: async (names: string[]) => {
      await Promise.all(names.map((name) => deleteGlobalVariable(projectId, name)));
    },
    onMutate: async (names) => {
      await queryClient.cancelQueries({ queryKey });

      const previousVariables = queryClient.getQueryData<GlobalVariable[]>(queryKey);

      queryClient.setQueryData<GlobalVariable[]>(queryKey, (old = []) =>
        old.filter((v) => !names.includes(v.name))
      );

      return { previousVariables };
    },
    onError: (error, _variables, context) => {
      if (context?.previousVariables) {
        queryClient.setQueryData(queryKey, context.previousVariables);
      }
      toast.error(`Failed to delete variables: ${error.message}`);
    },
    onSuccess: (_data, names) => {
      toast.success(`${names.length} variable(s) deleted successfully`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    variables: data || [],
    isLoading,
    error: error as Error | null,
    createVariable: (data) => createMutation.mutateAsync(data),
    updateVariable: (name, data) => updateMutation.mutateAsync({ name, data }),
    deleteVariable: (name) => deleteMutation.mutateAsync(name),
    deleteMultiple: (names) => deleteMultipleMutation.mutateAsync(names),
    refetch: () => {
      refetch();
    },
  };
}

/**
 * Detect variable type from value
 */
function detectVariableType(value: unknown): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'object';
  const type = typeof value;
  if (type === 'object') return 'object';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}
