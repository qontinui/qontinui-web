"use client";

import { useRunnerQuery, useRunnerMutation, runnerFetch } from "../api-client";
import type {
  ScheduledTask,
  SchedulerSettings,
  SchedulerStatus,
  TaskExecutionRecord,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
} from "../types/scheduler";

// =============================================================================
// Query Hooks
// =============================================================================

/** Fetch all scheduled tasks */
export function useScheduledTasks() {
  return useRunnerQuery<ScheduledTask[]>("/scheduler/tasks");
}

/** Fetch a single scheduled task by ID */
export function useScheduledTask(id: string | null) {
  return useRunnerQuery<ScheduledTask>(
    id != null ? `/scheduler/tasks/${id}` : null,
    { enabled: id != null }
  );
}

/** Fetch scheduler settings */
export function useSchedulerSettings() {
  return useRunnerQuery<SchedulerSettings>("/scheduler/settings");
}

/** Fetch scheduler status with polling */
export function useSchedulerStatus() {
  return useRunnerQuery<SchedulerStatus>("/scheduler/status", {
    pollInterval: 30000,
  });
}

/** Fetch execution history for a scheduled task */
export function useTaskHistory(taskId: string | null) {
  return useRunnerQuery<TaskExecutionRecord[]>(
    taskId != null ? `/scheduler/tasks/${taskId}/history` : null,
    { enabled: taskId != null }
  );
}

// =============================================================================
// Mutation Hooks
// =============================================================================

/** Create a new scheduled task */
export function useCreateScheduledTask() {
  return useRunnerMutation<CreateScheduledTaskRequest, ScheduledTask>(
    "/scheduler/tasks"
  );
}

// =============================================================================
// Direct Fetch Functions (for dynamic paths)
// =============================================================================

/** Update an existing scheduled task */
export async function updateScheduledTask(
  id: string,
  data: UpdateScheduledTaskRequest
): Promise<ScheduledTask> {
  return runnerFetch<ScheduledTask>(`/scheduler/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Delete a scheduled task */
export async function deleteScheduledTask(id: string): Promise<void> {
  return runnerFetch<void>(`/scheduler/tasks/${id}`, { method: "DELETE" });
}

/** Trigger immediate execution of a scheduled task */
export async function runScheduledTaskNow(id: string): Promise<void> {
  return runnerFetch<void>(`/scheduler/tasks/${id}/run`, { method: "POST" });
}
