/**
 * Workflow Mirror API Client
 *
 * Read-only client for ``/api/v1/workflows`` — the web-PG mirror of
 * runner-authored workflow definitions. Lets ``/build/workflows`` list
 * + browse workflows even when the operator's runner is offline.
 *
 * The mirror is populated by the runner's write-through on every local
 * CRUD; see Phase 3 of
 * ``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.
 *
 * Editing still flows through ``lib/api/unified-workflows`` (the runner
 * is still the write side); when the runner mutates, it pushes here.
 */

import { useCallback, useEffect, useState } from "react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

/** List-row shape — no definition for payload size. */
export interface WorkflowMirrorListItem {
  id: string;
  name: string;
  category: string | null;
  runner_updated_at: string;
  mirrored_at: string;
}

/** Detail shape — includes the full UnifiedWorkflow payload. */
export interface WorkflowMirrorDetail extends WorkflowMirrorListItem {
  definition: UnifiedWorkflow;
}

async function webApiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body && (body.detail || body.error)) ||
        `API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

export async function listMirrorWorkflows(params?: {
  category?: string;
}): Promise<WorkflowMirrorListItem[]> {
  const search = new URLSearchParams();
  if (params?.category) search.set("category", params.category);
  const qs = search.toString();
  return webApiFetch<WorkflowMirrorListItem[]>(
    `/workflows${qs ? `?${qs}` : ""}`
  );
}

export async function getMirrorWorkflow(
  id: string
): Promise<WorkflowMirrorDetail> {
  return webApiFetch<WorkflowMirrorDetail>(`/workflows/${id}`);
}

/**
 * React hook — read the workflow list from the web mirror.
 *
 * Returns a list-only shape (no per-workflow ``definition``). When a row
 * is selected, fetch the detail separately via ``getMirrorWorkflow``.
 *
 * Doesn't expose ``isOffline`` — the mirror is always available as long
 * as the web backend itself is reachable; runner reachability only
 * affects ``Run`` buttons, not the list.
 */
export function useWorkflowMirror() {
  const [data, setData] = useState<WorkflowMirrorListItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await listMirrorWorkflows();
      setData(result);
      setError(null);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load workflows");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
  }, [fetchData]);

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

  return { data, isLoading, error, refetch: fetchData };
}
