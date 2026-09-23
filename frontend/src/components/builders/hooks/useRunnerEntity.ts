"use client";

/**
 * React Query hooks for runner-native entities (playwright tests, prompt snippets, tests).
 * These entities live entirely in the runner (not backend API).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runnerFetch } from "@/lib/runner/api-client";
import { useRunnerApi } from "@/lib/runner/runner-api-object";
import { targetKey } from "@/lib/runner/target";
import { useRunnerTarget } from "@/contexts/active-runner-context";
import type {
  PlaywrightScript,
  PromptSnippet,
  SavedPrompt,
} from "@/lib/runner/types/library";

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

/**
 * A list query key scoped to the runner it was fetched from, so one runner's
 * entities are never served as another's. Invalidation by
 * `runnerEntityKeys.type(t)` still matches every runner's entry.
 */
function useRunnerListKey(t: string) {
  const target = useRunnerTarget();
  return [...runnerEntityKeys.list(t), targetKey(target)] as const;
}

// =============================================================================
// Playwright Tests
// =============================================================================

export function usePlaywrightTestsList() {
  const runnerApi = useRunnerApi();
  const queryKey = useRunnerListKey("playwright-tests");
  return useQuery({
    queryKey,
    queryFn: () => runnerApi.getPlaywrightTests(),
    staleTime: 30000,
  });
}

export function useCreatePlaywrightTest() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (data: Partial<PlaywrightScript>) =>
      runnerApi.createPlaywrightTest(data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("playwright-tests"),
      });
    },
  });
}

export function useUpdatePlaywrightTest() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<PlaywrightScript>;
    }) => runnerApi.updatePlaywrightTest(id, data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("playwright-tests"),
      });
    },
  });
}

export function useDeletePlaywrightTest() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (id: string) => runnerApi.deletePlaywrightTest(id),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("playwright-tests"),
      });
    },
  });
}

export function useDuplicatePlaywrightTest() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: ({ id, newName }: { id: string; newName?: string }) =>
      runnerApi.duplicatePlaywrightTest(id, newName),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("playwright-tests"),
      });
    },
  });
}

// =============================================================================
// Prompt Snippets
// =============================================================================

export function useRunnerPromptSnippetsList() {
  const runnerApi = useRunnerApi();
  const queryKey = useRunnerListKey("prompt-snippets");
  return useQuery({
    queryKey,
    queryFn: () => runnerApi.getPromptSnippets(),
    staleTime: 30000,
  });
}

export function useCreateRunnerPromptSnippet() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (data: Partial<PromptSnippet>) =>
      runnerApi.createPromptSnippet(data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("prompt-snippets"),
      });
    },
  });
}

export function useUpdateRunnerPromptSnippet() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PromptSnippet> }) =>
      runnerApi.updatePromptSnippet(id, data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("prompt-snippets"),
      });
    },
  });
}

export function useDeleteRunnerPromptSnippet() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (id: string) => runnerApi.deletePromptSnippet(id),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: runnerEntityKeys.type("prompt-snippets"),
      });
    },
  });
}

// =============================================================================
// Prompts (Tasks)
// =============================================================================

export function usePromptsList() {
  const runnerApi = useRunnerApi();
  const queryKey = useRunnerListKey("prompts");
  return useQuery({
    queryKey,
    queryFn: () => runnerApi.getPrompts(),
    staleTime: 30000,
  });
}

export function useCreatePrompt() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (data: Partial<SavedPrompt>) => runnerApi.createPrompt(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("prompts") });
    },
  });
}

export function useUpdatePrompt() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SavedPrompt> }) =>
      runnerApi.updatePrompt(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("prompts") });
    },
  });
}

export function useDeletePrompt() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (id: string) => runnerApi.deletePrompt(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("prompts") });
    },
  });
}

export function useDuplicatePrompt() {
  const qc = useQueryClient();
  const runnerApi = useRunnerApi();
  return useMutation({
    mutationFn: (id: string) => runnerApi.duplicatePrompt(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("prompts") });
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
  const target = useRunnerTarget();
  const queryKey = useRunnerListKey("tests");
  return useQuery({
    queryKey,
    queryFn: () => runnerFetch<RunnerTest[]>(target, "/tests"),
    staleTime: 30000,
  });
}

export function useCreateTest() {
  const qc = useQueryClient();
  const target = useRunnerTarget();
  return useMutation({
    mutationFn: async (data: Partial<RunnerTest>) => {
      return runnerFetch<RunnerTest>(target, "/tests", {
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
  const target = useRunnerTarget();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<RunnerTest>;
    }) => {
      return runnerFetch<RunnerTest>(target, `/tests/${id}`, {
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
  const target = useRunnerTarget();
  return useMutation({
    mutationFn: async (id: string) => {
      return runnerFetch<void>(target, `/tests/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("tests") });
    },
  });
}

export function useDuplicateTest() {
  const qc = useQueryClient();
  const target = useRunnerTarget();
  return useMutation({
    mutationFn: async ({ id, newName }: { id: string; newName?: string }) => {
      // Get original, create copy
      const original = await runnerFetch<RunnerTest>(target, `/tests/${id}`);
      const copy = {
        ...original,
        id: undefined,
        name: newName ?? `${original.name} (Copy)`,
        created_at: undefined,
        updated_at: undefined,
      };
      return runnerFetch<RunnerTest>(target, "/tests", {
        method: "POST",
        body: JSON.stringify(copy),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runnerEntityKeys.type("tests") });
    },
  });
}

export function useExecuteTest() {
  const target = useRunnerTarget();
  return useMutation({
    mutationFn: async (id: string) => {
      return runnerFetch<Record<string, unknown>>(
        target,
        `/tests/${id}/execute`,
        {
          method: "POST",
          timeoutMs: 120000,
        }
      );
    },
  });
}
