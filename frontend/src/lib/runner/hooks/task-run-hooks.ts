"use client";

import {
  useRunnerQuery,
  useRunnerMutation,
  DEFAULT_POLL_INTERVAL,
} from "../api-client";
import type {
  TaskRun,
  TaskRunOutput,
  TaskRunKnowledge,
  Finding,
  VerificationResult,
  VerificationSummary,
  VerificationData,
  PlaywrightResult,
  VerificationPhaseResult,
  VerificationPhaseResultsData,
  TaskRunEvent,
  Screenshot,
  TaskRunScreenshot,
  SessionState,
  FindingsSummary,
  Checkpoint,
  McpCall,
} from "../types/task-run";

export function useTaskRuns(params?: { limit?: number; status?: string }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.status) query.set("status", params.status);
  const qs = query.toString();
  return useRunnerQuery<TaskRun[]>(`/task-runs${qs ? `?${qs}` : ""}`);
}

export function useRunningTaskRuns() {
  return useRunnerQuery<TaskRun[]>("/task-runs/running", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

export function useTaskRun(id: string | number | null) {
  return useRunnerQuery<TaskRun>(id != null ? `/task-runs/${id}` : null, {
    enabled: id != null,
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}

export function useTaskRunOutput(id: string | number | null) {
  return useRunnerQuery<TaskRunOutput>(
    id != null ? `/task-runs/${id}/output` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        // API returns { id, output } but our type expects output_log
        if (obj && typeof obj === "object") {
          return {
            id: obj.id as number,
            output_log:
              (obj.output_log as string) ?? (obj.output as string) ?? "",
          } as TaskRunOutput;
        }
        return raw as TaskRunOutput;
      },
    }
  );
}

export function useTaskRunKnowledge(id: string | number | null) {
  return useRunnerQuery<TaskRunKnowledge>(
    id != null ? `/task-runs/${id}/knowledge` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        // API returns { knowledge: [...], summary: {...} } - map to TaskRunKnowledge shape
        if (
          obj &&
          typeof obj === "object" &&
          "knowledge" in obj &&
          Array.isArray(obj.knowledge)
        ) {
          const items = obj.knowledge as Array<Record<string, unknown>>;
          return {
            findings: items.filter(
              (k) => k.category === "finding"
            ) as unknown as Finding[],
            observations: items
              .filter((k) => k.category === "observation")
              .map((k) => String(k.content || k.title || "")),
            hypotheses: items
              .filter((k) => k.category === "hypothesis")
              .map((k) => String(k.content || k.title || "")),
          };
        }
        // Already in correct shape
        if (obj && "findings" in obj) return obj as unknown as TaskRunKnowledge;
        return { findings: [], observations: [], hypotheses: [] };
      },
    }
  );
}

export function useTaskRunVerification(id: string | number | null) {
  return useRunnerQuery<VerificationData>(
    id != null ? `/task-runs/${id}/verification-results` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "results" in obj &&
          Array.isArray(obj.results)
        ) {
          return {
            results: obj.results as VerificationResult[],
            summary: (obj.summary as VerificationSummary) ?? null,
          };
        }
        if (Array.isArray(raw))
          return { results: raw as VerificationResult[], summary: null };
        return { results: [], summary: null };
      },
    }
  );
}

export function useTaskRunPlaywright(id: string | number | null) {
  return useRunnerQuery<PlaywrightResult[]>(
    id != null ? `/task-runs/${id}/playwright-results` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "results" in obj &&
          Array.isArray(obj.results)
        )
          return obj.results as PlaywrightResult[];
        if (Array.isArray(raw)) return raw as PlaywrightResult[];
        return [];
      },
    }
  );
}

export function useTaskRunVerificationPhaseResults(id: string | number | null) {
  return useRunnerQuery<VerificationPhaseResultsData>(
    id != null ? `/task-runs/${id}/verification-phase-results` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "results" in obj &&
          Array.isArray(obj.results)
        ) {
          return {
            task_run_id: (obj.task_run_id as string) ?? "",
            results: obj.results as VerificationPhaseResult[],
            count: (obj.count as number) ?? obj.results.length,
            passed_iterations: (obj.passed_iterations as number) ?? 0,
            failed_iterations: (obj.failed_iterations as number) ?? 0,
          };
        }
        return {
          task_run_id: "",
          results: [],
          count: 0,
          passed_iterations: 0,
          failed_iterations: 0,
        };
      },
    }
  );
}

export function useTaskRunEvents(id: string | number | null) {
  return useRunnerQuery<TaskRunEvent[]>(
    id != null ? `/task-runs/${id}/events` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "events" in obj &&
          Array.isArray(obj.events)
        )
          return obj.events as TaskRunEvent[];
        if (Array.isArray(raw)) return raw as TaskRunEvent[];
        return [];
      },
    }
  );
}

export function useTaskRunScreenshots(id: string | number | null) {
  return useRunnerQuery<Screenshot[]>(
    id != null ? `/task-runs/${id}/screenshots` : null,
    {
      enabled: id != null,
      pollInterval: 3000,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "screenshots" in obj &&
          Array.isArray(obj.screenshots)
        )
          return obj.screenshots as Screenshot[];
        if (Array.isArray(raw)) return raw as Screenshot[];
        return [];
      },
    }
  );
}

export function useTaskRunScreenshotsDetailed(id: string | number | null) {
  return useRunnerQuery<TaskRunScreenshot[]>(
    id != null ? `/task-runs/${id}/screenshots` : null,
    {
      enabled: id != null,
      pollInterval: 3000,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "screenshots" in obj &&
          Array.isArray(obj.screenshots)
        )
          return obj.screenshots as TaskRunScreenshot[];
        if (Array.isArray(raw)) return raw as TaskRunScreenshot[];
        return [];
      },
    }
  );
}

export function useSessionState(id: string | number | null) {
  return useRunnerQuery<SessionState>(
    id != null ? `/task-runs/${id}/session-state` : null,
    { enabled: id != null, pollInterval: 3000 }
  );
}

export function useFindingsSummary() {
  return useRunnerQuery<FindingsSummary>("/findings/summary");
}

export function useTaskRunCheckpoints(id: string | number | null) {
  return useRunnerQuery<Checkpoint[]>(
    id != null ? `/task-runs/${id}/checkpoints?limit=100` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "checkpoints" in obj &&
          Array.isArray(obj.checkpoints)
        )
          return obj.checkpoints as Checkpoint[];
        if (Array.isArray(raw)) return raw as Checkpoint[];
        return [];
      },
    }
  );
}

export function useTaskRunMcpCalls(id: string | number | null) {
  return useRunnerQuery<McpCall[]>(
    id != null ? `/task-runs/${id}/mcp-calls` : null,
    {
      enabled: id != null,
      transform: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "calls" in obj &&
          Array.isArray(obj.calls)
        )
          return obj.calls as McpCall[];
        if (Array.isArray(raw)) return raw as McpCall[];
        return [];
      },
    }
  );
}

export function useStopTaskRun() {
  return useRunnerMutation<{ task_run_id: string }, void>("/task-runs/stop");
}
