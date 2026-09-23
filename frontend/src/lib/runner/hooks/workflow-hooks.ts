"use client";

import {
  useRunnerQuery,
  useRunnerMutation,
  DEFAULT_POLL_INTERVAL,
} from "../api-client";
import {
  useDispatchRunnerTarget,
  useRunnerTarget,
} from "@/contexts/active-runner-context";
import type { GuiLockInfo } from "../types/task-run";

// Mutations

/**
 * Run a workflow — NEW work, so it goes only to the explicit choice or
 * coord's resolved pick. `refusal` is coord's outcome when it may not run
 * (disable the action and show it); a call made anyway is refused with it.
 */
export function useRunWorkflow() {
  const { target, refusal } = useDispatchRunnerTarget();
  return {
    ...useRunnerMutation<
      { workflow_id: string; monitor?: string },
      { task_run_id: string }
    >(target, "/unified-workflows/run"),
    refusal,
  };
}

// GUI lock status - indicates whether a visual automation run holds the GUI
export function useGuiLock() {
  return useRunnerQuery<GuiLockInfo>(useRunnerTarget(), "/gui-lock", {
    pollInterval: DEFAULT_POLL_INTERVAL,
  });
}
