/**
 * Integration testing operations for the runner client.
 *
 * Handles test execution, assertions, mocking, and state traversal.
 */

import { BaseClient } from "./base-client";
import type {
  StartIntegrationTestRequest,
  TestRunStatus,
  TestRunSummary,
  TestRunResult,
  TestResult,
  AssertionResult,
  TestingState,
  TestingTransition,
  MockMode,
  MockedAction,
} from "./types";

export class TestingClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

  /**
   * Start an integration test run
   */
  async startIntegrationTest(
    request: StartIntegrationTestRequest
  ): Promise<{ success: boolean; run_id?: string; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.base.baseUrl}/testing/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to start test: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        run_id: data.data?.run_id,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to start integration test",
      };
    }
  }

  /**
   * Get test run status
   */
  async getTestRunStatus(runId: string): Promise<{
    success: boolean;
    status?: TestRunStatus;
    progress?: {
      total: number;
      passed: number;
      failed: number;
      pending: number;
    };
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/status/${runId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get status: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        status: data.data?.status,
        progress: data.data?.progress,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get test status",
      };
    }
  }

  /**
   * Get test results
   */
  async getTestResults(
    runId: string
  ): Promise<{ success: boolean; results?: TestResult[]; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/results/${runId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get results: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        results: data.data?.results,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get test results",
      };
    }
  }

  /**
   * List test runs
   */
  async listTestRuns(
    limit = 50
  ): Promise<{ success: boolean; runs?: TestRunSummary[]; error?: string }> {
    try {
      const response = await fetch(
        `${this.base.baseUrl}/testing/runs?limit=${limit}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to list runs: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        runs: data.data?.runs,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to list test runs",
      };
    }
  }

  /**
   * End test run
   */
  async endTestRun(
    runId: string
  ): Promise<{ success: boolean; run?: TestRunResult; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/end/${runId}`, {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to end test: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        run: data.data?.run,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to end test run",
      };
    }
  }

  /**
   * Get testing states
   */
  async getTestingStates(): Promise<{
    success: boolean;
    states?: TestingState[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/states`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get states: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        states: data.data?.states,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get states",
      };
    }
  }

  /**
   * Get testing transitions
   */
  async getTestingTransitions(): Promise<{
    success: boolean;
    transitions?: TestingTransition[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/transitions`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get transitions: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        transitions: data.data?.transitions,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get transitions",
      };
    }
  }

  /**
   * Find path between states
   */
  async findPath(
    fromState: string,
    toState: string
  ): Promise<{ success: boolean; path?: unknown; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/find-path`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ from_state: fromState, to_state: toState }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to find path: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: data.data?.success ?? true,
        path: data.data?.path,
        error: data.data?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to find path",
      };
    }
  }

  /**
   * Traverse to state
   */
  async traverseToState(
    targetState: string,
    execute = true
  ): Promise<{ success: boolean; active_states?: string[]; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/traverse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ target_state: targetState, execute }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to traverse: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: data.data?.success ?? true,
        active_states: data.data?.active_states,
        error: data.data?.error,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to traverse to state",
      };
    }
  }

  /**
   * Get active states
   */
  async getActiveStates(): Promise<{
    success: boolean;
    active_states?: string[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/active-states`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get active states: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        active_states: data.data?.active_states,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get active states",
      };
    }
  }

  /**
   * Set mock mode
   */
  async setMockMode(
    mode: MockMode
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/mock-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to set mock mode: ${response.status}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to set mock mode",
      };
    }
  }

  /**
   * Mock an action
   */
  async mockAction(
    actionType: string,
    params: Record<string, unknown>
  ): Promise<{ success: boolean; action_id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/mock-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ action_type: actionType, ...params }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to mock action: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        action_id: data.data?.action_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to mock action",
      };
    }
  }

  /**
   * Get mocked actions
   */
  async getMockedActions(): Promise<{
    success: boolean;
    actions?: MockedAction[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/mocked-actions`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get mocked actions: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        actions: data.data?.actions,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get mocked actions",
      };
    }
  }

  /**
   * Clear mocked actions
   */
  async clearMockedActions(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${this.base.baseUrl}/testing/clear-mocked-actions`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to clear mocked actions: ${response.status}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to clear mocked actions",
      };
    }
  }

  /**
   * Run an assertion
   */
  async runAssertion(
    assertionType: string,
    target: string,
    expected?: unknown,
    timeoutSeconds = 30
  ): Promise<{
    success: boolean;
    assertion?: AssertionResult;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.base.baseUrl}/testing/assertion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          assertion_type: assertionType,
          target,
          expected,
          timeout_seconds: timeoutSeconds,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to run assertion: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        assertion: data.data?.assertion,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to run assertion",
      };
    }
  }
}
