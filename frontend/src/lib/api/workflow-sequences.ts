/**
 * Workflow Sequences API Client
 *
 * CRUD operations and React hooks for workflow sequences stored in PostgreSQL
 * via the backend API.
 */

import { useState, useCallback, useEffect } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface WorkflowSequence {
  id: string;
  project_id: string;
  created_by: string;
  name: string;
  description: string | null;
  workflow_ids: string[];
  stop_on_failure: boolean;
  schedule: { item_schedules: (string | null)[]; timezone: string } | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowSequenceSummary {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  workflow_count: number;
  has_schedule: boolean;
  created_at: string;
}

interface WorkflowSequenceListResponse {
  sequences: WorkflowSequenceSummary[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

interface WorkflowSequenceCreateData {
  name: string;
  description?: string | null;
  workflow_ids: string[];
  stop_on_failure?: boolean;
  schedule?: { item_schedules: (string | null)[]; timezone?: string } | null;
}

interface WorkflowSequenceUpdateData {
  name?: string;
  description?: string | null;
  workflow_ids?: string[];
  stop_on_failure?: boolean;
  schedule?: { item_schedules: (string | null)[]; timezone?: string } | null;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Cookie-based auth is used — credentials: "include" handles it
  return headers;
}

async function backendFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.detail || `API error: ${response.status} ${response.statusText}`
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// CRUD Operations

export async function listSequences(
  projectId: string
): Promise<WorkflowSequenceListResponse> {
  return backendFetch<WorkflowSequenceListResponse>(
    `/projects/${projectId}/workflow-sequences`
  );
}

export async function getSequence(
  projectId: string,
  id: string
): Promise<WorkflowSequence> {
  return backendFetch<WorkflowSequence>(
    `/projects/${projectId}/workflow-sequences/${id}`
  );
}

export async function createSequence(
  projectId: string,
  data: WorkflowSequenceCreateData
): Promise<WorkflowSequence> {
  return backendFetch<WorkflowSequence>(
    `/projects/${projectId}/workflow-sequences`,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
}

export async function updateSequence(
  projectId: string,
  id: string,
  data: WorkflowSequenceUpdateData
): Promise<WorkflowSequence> {
  return backendFetch<WorkflowSequence>(
    `/projects/${projectId}/workflow-sequences/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
}

export async function deleteSequence(
  projectId: string,
  id: string
): Promise<void> {
  return backendFetch<void>(`/projects/${projectId}/workflow-sequences/${id}`, {
    method: "DELETE",
  });
}

// React Hook

export function useWorkflowSequences(projectId: string | null) {
  const [data, setData] = useState<WorkflowSequenceSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }
    try {
      const result = await listSequences(projectId);
      setData(result.sequences);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sequences");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

export type {
  WorkflowSequence,
  WorkflowSequenceSummary,
  WorkflowSequenceCreateData,
  WorkflowSequenceUpdateData,
  WorkflowSequenceListResponse,
};
