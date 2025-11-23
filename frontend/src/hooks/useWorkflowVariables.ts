/**
 * Custom hook for fetching and managing workflow variables
 *
 * Features:
 * - Auto-refresh with configurable interval
 * - Fetches current variable snapshot
 * - Fetches variable change history
 * - Caching with TanStack Query
 * - Error handling and loading states
 *
 * Example usage:
 *
 * ```tsx
 * function VariableMonitor({ runId }: { runId: string }) {
 *   const { variables, history, isLoading, error, refetch } = useWorkflowVariables(runId, 1000);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <div>
 *       <h2>Current Variables</h2>
 *       {Object.entries(variables?.variables.execution || {}).map(([name, value]) => (
 *         <div key={name}>{name}: {JSON.stringify(value)}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  VariablesResponse,
  VariableChangesResponse,
  WorkflowVariable,
  VariableSnapshot,
  VariableChange,
} from '@/types/workflow-variables';

/**
 * Query keys for organizing cache
 */
export const workflowVariableKeys = {
  all: ['workflow-variables'] as const,
  runs: () => [...workflowVariableKeys.all, 'runs'] as const,
  run: (runId: string) => [...workflowVariableKeys.runs(), runId] as const,
  variables: (runId: string) => [...workflowVariableKeys.run(runId), 'variables'] as const,
  history: (runId: string) => [...workflowVariableKeys.run(runId), 'history'] as const,
};

/**
 * Fetch current variables for a workflow run
 */
async function fetchVariables(runId: string): Promise<VariablesResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/workflow-runs/${runId}/variables`,
    {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch variables: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch variable change history for a workflow run
 */
async function fetchVariableHistory(runId: string): Promise<VariableChangesResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/workflow-runs/${runId}/variable-changes`,
    {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch variable history: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Hook to fetch current workflow variables with auto-refresh
 *
 * @param runId - Workflow run ID
 * @param refreshInterval - Auto-refresh interval in milliseconds (default: 1000ms, 0 = disabled)
 * @param enabled - Whether to run the query (defaults to true)
 */
export function useWorkflowVariables(
  runId: string,
  refreshInterval = 1000,
  enabled = true
) {
  // Fetch current variables
  const variablesQuery = useQuery({
    queryKey: workflowVariableKeys.variables(runId),
    queryFn: () => fetchVariables(runId),
    enabled: enabled && !!runId,
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    // Keep previous data while fetching to prevent UI flicker
    placeholderData: (previousData) => previousData,
    // Reduce stale time for real-time updates
    staleTime: 0,
  });

  // Fetch change history
  const historyQuery = useQuery({
    queryKey: workflowVariableKeys.history(runId),
    queryFn: () => fetchVariableHistory(runId),
    enabled: enabled && !!runId,
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    placeholderData: (previousData) => previousData,
    staleTime: 0,
  });

  // Transform snapshot into flat array of WorkflowVariable objects
  const flattenedVariables: WorkflowVariable[] = [];
  if (variablesQuery.data?.variables) {
    const snapshot = variablesQuery.data.variables;

    // Add execution-scoped variables
    Object.entries(snapshot.execution || {}).forEach(([name, value]) => {
      flattenedVariables.push({
        name,
        value,
        scope: 'execution',
        last_updated: variablesQuery.data.fetched_at,
        type: getValueType(value),
      });
    });

    // Add workflow-scoped variables
    Object.entries(snapshot.workflow || {}).forEach(([name, value]) => {
      flattenedVariables.push({
        name,
        value,
        scope: 'workflow',
        last_updated: variablesQuery.data.fetched_at,
        type: getValueType(value),
      });
    });

    // Add global variables
    Object.entries(snapshot.global || {}).forEach(([name, value]) => {
      flattenedVariables.push({
        name,
        value,
        scope: 'global',
        last_updated: variablesQuery.data.fetched_at,
        type: getValueType(value),
      });
    });
  }

  return {
    // Current variables
    variables: variablesQuery.data,
    variablesSnapshot: variablesQuery.data?.variables,
    flattenedVariables,

    // Change history
    history: historyQuery.data?.history.changes || [],
    historyTotal: historyQuery.data?.history.total || 0,

    // Loading states
    isLoading: variablesQuery.isLoading || historyQuery.isLoading,
    isLoadingVariables: variablesQuery.isLoading,
    isLoadingHistory: historyQuery.isLoading,

    // Error states
    error: variablesQuery.error || historyQuery.error,
    variablesError: variablesQuery.error,
    historyError: historyQuery.error,

    // Refetch functions
    refetch: () => {
      variablesQuery.refetch();
      historyQuery.refetch();
    },
    refetchVariables: variablesQuery.refetch,
    refetchHistory: historyQuery.refetch,

    // Query states
    isFetching: variablesQuery.isFetching || historyQuery.isFetching,
  };
}

/**
 * Hook to fetch only variable changes (without current snapshot)
 *
 * @param runId - Workflow run ID
 * @param refreshInterval - Auto-refresh interval in milliseconds (default: 1000ms, 0 = disabled)
 * @param enabled - Whether to run the query (defaults to true)
 */
export function useVariableHistory(
  runId: string,
  refreshInterval = 1000,
  enabled = true
) {
  return useQuery({
    queryKey: workflowVariableKeys.history(runId),
    queryFn: () => fetchVariableHistory(runId),
    enabled: enabled && !!runId,
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    placeholderData: (previousData) => previousData,
    staleTime: 0,
  });
}

/**
 * Helper function to determine the type of a variable value
 */
function getValueType(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Helper function to format variable values for display
 */
export function formatVariableValue(value: any, maxLength = 100): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = getValueType(value);

  if (type === 'string') {
    return value.length > maxLength ? `${value.substring(0, maxLength)}...` : value;
  }

  if (type === 'number' || type === 'boolean') {
    return String(value);
  }

  // For objects and arrays, use JSON
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > maxLength ? `${json.substring(0, maxLength)}...` : json;
  } catch {
    return '[Complex Object]';
  }
}

/**
 * Helper function to detect if a value has changed
 */
export function hasValueChanged(oldValue: any, newValue: any): boolean {
  // Handle null/undefined
  if (oldValue === null || oldValue === undefined) {
    return newValue !== null && newValue !== undefined;
  }
  if (newValue === null || newValue === undefined) {
    return true;
  }

  // For primitives, use direct comparison
  if (typeof oldValue !== 'object') {
    return oldValue !== newValue;
  }

  // For objects/arrays, use JSON comparison (simple but effective)
  try {
    return JSON.stringify(oldValue) !== JSON.stringify(newValue);
  } catch {
    return true;
  }
}
