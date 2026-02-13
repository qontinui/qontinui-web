/**
 * Unified Workflows API Client
 *
 * CRUD operations and React hooks for workflow definitions via the runner API
 * (SQLite). The runner is the source of truth for workflow definitions and
 * execution.
 */

import { useState, useCallback, useEffect } from "react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

const RUNNER_BASE =
  process.env.NEXT_PUBLIC_RUNNER_API_URL || "http://localhost:9876";

/** Runner API wraps responses in { success, data, error? } */
interface RunnerResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

async function runnerFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${RUNNER_BASE}/unified-workflows${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error || `Runner API error: ${response.status} ${response.statusText}`
    );
  }

  // 204 No Content (e.g. DELETE)
  if (response.status === 204) {
    return undefined as T;
  }

  const json: RunnerResponse<T> = await response.json();
  if (!json.success) {
    throw new Error(json.error || "Runner API request failed");
  }
  return json.data;
}

// =============================================================================
// CRUD Operations
// =============================================================================

export async function listWorkflows(params?: {
  category?: string;
}): Promise<UnifiedWorkflow[]> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set("category", params.category);

  const qs = searchParams.toString();
  return runnerFetch<UnifiedWorkflow[]>(qs ? `?${qs}` : "");
}

export async function getWorkflow(id: string): Promise<UnifiedWorkflow> {
  return runnerFetch<UnifiedWorkflow>(`/${id}`);
}

export async function createWorkflow(
  data: Partial<UnifiedWorkflow>
): Promise<UnifiedWorkflow> {
  return runnerFetch<UnifiedWorkflow>("", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateWorkflow(
  id: string,
  data: Partial<UnifiedWorkflow>
): Promise<UnifiedWorkflow> {
  return runnerFetch<UnifiedWorkflow>(`/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return runnerFetch<void>(`/${id}`, { method: "DELETE" });
}

// =============================================================================
// Search / Utility
// =============================================================================

export async function searchWorkflows(params?: {
  q?: string;
  category?: string;
  tag?: string;
}): Promise<UnifiedWorkflow[]> {
  const searchParams = new URLSearchParams();
  if (params?.q) searchParams.set("q", params.q);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.tag) searchParams.set("tag", params.tag);

  const qs = searchParams.toString();
  return runnerFetch<UnifiedWorkflow[]>(`/search${qs ? `?${qs}` : ""}`);
}

export async function duplicateWorkflow(id: string): Promise<UnifiedWorkflow> {
  return runnerFetch<UnifiedWorkflow>(`/${id}/duplicate`, {
    method: "POST",
  });
}

export async function exportWorkflow(id: string): Promise<unknown> {
  return runnerFetch<unknown>(`/${id}/export`);
}

export async function importWorkflow(data: unknown): Promise<UnifiedWorkflow> {
  return runnerFetch<UnifiedWorkflow>("/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// =============================================================================
// React Hooks
// =============================================================================

export function useUnifiedWorkflows() {
  const [data, setData] = useState<UnifiedWorkflow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await listWorkflows();
      setData(result);
      setError(null);
      setIsOffline(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load workflows";
      // Detect runner offline (fetch failures)
      if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("ECONNREFUSED")
      ) {
        setIsOffline(true);
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, isOffline, refetch: fetchData };
}

export function useUnifiedWorkflow(id: string | null) {
  const [data, setData] = useState<UnifiedWorkflow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const result = await getWorkflow(id);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchData();
  }, [fetchData, id]);

  return { data, isLoading, error, isOffline: false, refetch: fetchData };
}
