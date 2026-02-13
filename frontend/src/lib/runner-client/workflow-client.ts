/**
 * Workflow execution operations for the runner client.
 *
 * Handles runWorkflow and stopWorkflow.
 */

import { BaseClient } from "./base-client";
import type { RunWorkflowResponse } from "./types";

export class WorkflowClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

  /**
   * Run a workflow by name
   * Requires a config to be loaded first via loadConfig()
   */
  async runWorkflow(
    workflowName: string,
    options: { monitorIndex?: number; timeoutSeconds?: number } = {}
  ): Promise<RunWorkflowResponse> {
    const controller = new AbortController();
    const timeoutMs = (options.timeoutSeconds ?? 300) * 1000 + 30000; // Add 30s buffer
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.base.baseUrl}/run-workflow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          workflow_name: workflowName,
          monitor_index: options.monitorIndex,
          timeout_seconds: options.timeoutSeconds ?? 300,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          workflow_name: workflowName,
          error: `Failed to run workflow: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.data.success ?? data.success ?? true,
          workflow_name: workflowName,
          execution_time_ms: data.data.execution_time_ms,
          states_visited: data.data.states_visited,
          error: data.data.error ?? data.error,
        };
      }
      return {
        success: data.success ?? true,
        workflow_name: workflowName,
        execution_time_ms: data.execution_time_ms,
        states_visited: data.states_visited,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        workflow_name: workflowName,
        error:
          error instanceof Error ? error.message : "Failed to run workflow",
      };
    }
  }

  /**
   * Stop the current workflow execution
   */
  async stopWorkflow(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/stop-execution`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to stop workflow: ${response.status} - ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to stop workflow",
      };
    }
  }
}
