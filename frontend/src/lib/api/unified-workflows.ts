/**
 * Unified Workflows API Client
 *
 * CRUD operations and React hooks for workflow definitions via the WEB API
 * (`/api/v1/unified-workflows`, backed by PostgreSQL `project.unified_workflows`).
 *
 * The web endpoint is lossless: request bodies are the full canonical
 * (camelCase) ``UnifiedWorkflow`` object and responses are the canonical
 * object directly (NOT a ``{success, data}`` envelope). List/search return
 * ``{ items, pagination }``. The runner is needed ONLY to execute a workflow;
 * authoring/listing/saving hit the web backend with no co-located runner.
 */

import { useState, useCallback, useEffect } from "react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const API_BASE = ApiConfig.API_BASE_URL;
const API_PREFIX = "/api/v1/unified-workflows";

/** List/search responses wrap items in a paginated envelope. */
interface ListResponse {
  items: UnifiedWorkflow[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * Error carrying the HTTP status alongside the backend message.
 *
 * Callers (and the `useUnifiedWorkflows` hook) need the status to decide how
 * to present a failure: a raw backend error code (`UNAUTHORIZED`) must never
 * be rendered to the user, so the UI maps `status` to friendly copy instead of
 * interpolating `message`.
 */
export class WorkflowApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkflowApiError";
    this.status = status;
  }
}

async function webFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Routed through httpClient (NOT bare `fetch`) so the request carries the
  // `Authorization: Bearer` header and inherits the shared 401 refresh /
  // session-expiry path. A bare fetch 401s in prod (Cognito bearer auth).
  const response = await httpClient.fetch(`${API_BASE}${API_PREFIX}${path}`, {
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new WorkflowApiError(
      (body && (body.detail || body.error)) ||
        `API error: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  // 204 No Content (e.g. DELETE)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
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
  const result = await webFetch<ListResponse>(qs ? `?${qs}` : "");
  return result.items;
}

export async function getWorkflow(id: string): Promise<UnifiedWorkflow> {
  return webFetch<UnifiedWorkflow>(`/${id}`);
}

export async function createWorkflow(
  data: Partial<UnifiedWorkflow>
): Promise<UnifiedWorkflow> {
  return webFetch<UnifiedWorkflow>("", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateWorkflow(
  id: string,
  data: Partial<UnifiedWorkflow>
): Promise<UnifiedWorkflow> {
  return webFetch<UnifiedWorkflow>(`/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return webFetch<void>(`/${id}`, { method: "DELETE" });
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
  const result = await webFetch<ListResponse>(`/search${qs ? `?${qs}` : ""}`);
  return result.items;
}

export async function duplicateWorkflow(id: string): Promise<UnifiedWorkflow> {
  return webFetch<UnifiedWorkflow>(`/${id}/duplicate`, {
    method: "POST",
  });
}

export async function exportWorkflow(id: string): Promise<unknown> {
  return webFetch<unknown>(`/${id}/export`);
}

export async function importWorkflow(data: unknown): Promise<UnifiedWorkflow> {
  return webFetch<UnifiedWorkflow>("/import", {
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
  // HTTP status of the failing request, when the failure came from the API.
  // Consumers map this to user-facing copy; the raw `error` message is a
  // backend diagnostic (e.g. `UNAUTHORIZED`) and must not be rendered.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const result = await listWorkflows();
      setData(result);
      setError(null);
      setErrorStatus(null);
      setIsOffline(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load workflows";
      // Detect WEB backend unreachable (fetch failures). Runner connectivity
      // is gated separately via useRunnerHealth; this only reflects whether
      // the web API itself is reachable.
      if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("ECONNREFUSED")
      ) {
        setIsOffline(true);
      }
      setError(message);
      setErrorStatus(err instanceof WorkflowApiError ? err.status : null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
  }, [fetchData]);

  // Refetch when page regains visibility or focus (picks up workflows
  // created in another tab/session).
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    const onFocus = () => fetchData();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchData]);

  return { data, isLoading, error, errorStatus, isOffline, refetch: fetchData };
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
