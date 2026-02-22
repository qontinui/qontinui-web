"use client";

import {
  useRunnerQuery,
  useRunnerMutation,
  DEFAULT_POLL_INTERVAL,
} from "../api-client";
import type { GuiLockInfo } from "../types/task-run";

// Mutations
export function useRunWorkflow() {
  return useRunnerMutation<
    { workflow_id: string; monitor?: string },
    { task_run_id: string }
  >("/unified-workflows/run");
}

// GUI lock status - indicates whether a visual automation run holds the GUI
export function useGuiLock() {
  return useRunnerQuery<GuiLockInfo>("/gui-lock", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}
