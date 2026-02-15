"use client";

/**
 * React Query hooks for runner-native entities (scripts, scriptlets, tests).
 * These entities live entirely in the runner (not backend API).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { PlaywrightScript, Scriptlet } from "@/lib/runner/types/library";

// =============================================================================
// Query Key Factory
// =============================================================================

export const runnerEntityKeys = {
  all: ["runner-entity"] as const,
  type: (t: string) => [...runnerEntityKeys.all, t] as const,
  list: (t: string) => [...runnerEntityKeys.type(t), "list"] as const,
  detail: (t: string, id: string) =>
    [...runnerEntityKeys.type(t), "detail", id] as const,
};

// =============================================================================
// Scripts (Playwright)
// =============================================================================

export function useScriptsList() {
  return useQuery({
    queryKey: runnerEntityKeys.list("scripts"),
    queryFn: () => runnerApi.getPlaywrightScripts(),
    staleTime: 30000,
  });
}

export function useCreateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<PlaywrightScript>) =>
      runnerApi.createPlaywrightScript(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("scripts") });
    },
  });
}

export function useUpdateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlaywrightScript> }) =>
      runnerApi.updatePlaywrightScript(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("scripts") });
    },
  });
}

export function useDeleteScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runnerApi.deletePlaywrightScript(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("scripts") });
    },
  });
}

export function useDuplicateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newName }: { id: string; newName?: string }) =>
      runnerApi.duplicatePlaywrightScript(id, newName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("scripts") });
    },
  });
}

// =============================================================================
// Scriptlets
// =============================================================================

export function useRunnerScriptletsList() {
  return useQuery({
    queryKey: runnerEntityKeys.list("scriptlets"),
    queryFn: () => runnerApi.getScriptlets(),
    staleTime: 30000,
  });
}

export function useCreateRunnerScriptlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Scriptlet>) => runnerApi.createScriptlet(data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("scriptlets"),
      });
    },
  });
}

export function useUpdateRunnerScriptlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Scriptlet> }) =>
      runnerApi.updateScriptlet(id, data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("scriptlets"),
      });
    },
  });
}

export function useDeleteRunnerScriptlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runnerApi.deleteScriptlet(id),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("scriptlets"),
      });
    },
  });
}

// =============================================================================
// Tests (runner-native /tests endpoint)
// =============================================================================

export interface RunnerTest {
  id: string;
  name: string;
  description?: string;
  test_type: string;
  code: string;
  url?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export function useTestsList() {
  return useQuery({
    queryKey: runnerEntityKeys.list("tests"),
    queryFn: async () => {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      return runnerFetch<RunnerTest[]>("/tests");
    },
    staleTime: 30000,
  });
}

export function useCreateTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<RunnerTest>) => {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      return runnerFetch<RunnerTest>("/tests", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("tests") });
    },
  });
}

export function useUpdateTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RunnerTest> }) => {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      return runnerFetch<RunnerTest>(`/tests/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("tests") });
    },
  });
}

export function useDeleteTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      return runnerFetch<void>(`/tests/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("tests") });
    },
  });
}

export function useExecuteTest() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      return runnerFetch<Record<string, unknown>>(`/tests/${id}/execute`, {
        method: "POST",
        timeoutMs: 120000,
      });
    },
  });
}
