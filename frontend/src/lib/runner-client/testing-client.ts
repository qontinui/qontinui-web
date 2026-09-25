/**
 * Integration testing operations for the runner client.
 *
 * Handles test execution, assertions, mocking, and state traversal.
 */

import { runnerRequest } from "@/lib/runner/api-client";
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
    try {
      const response = await runnerRequest(this.base.target, "/testing/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        timeoutMs: 30000,
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to start test"
        );
        return {
          success: false,
          error: message,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        run_id: data.data?.run_id,
        error: data.error,
      };
    } catch (error) {
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
      const response = await runnerRequest(
        this.base.target,
        `/testing/status/${runId}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get status",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        `/testing/results/${runId}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 30000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get results",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        `/testing/runs?limit=${limit}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to list runs",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        `/testing/end/${runId}`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          timeoutMs: 30000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to end test",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/states",
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get states",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/transitions",
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get transitions",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/find-path",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ from_state: fromState, to_state: toState }),
          timeoutMs: 30000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to find path",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/traverse",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ target_state: targetState, execute }),
          timeoutMs: 120000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to traverse",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/active-states",
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get active states",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/mock-mode",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ mode }),
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to set mock mode",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/mock-action",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ action_type: actionType, ...params }),
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to mock action",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/mocked-actions",
        {
          method: "GET",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get mocked actions",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/clear-mocked-actions",
        {
          method: "POST",
          headers: { Accept: "application/json" },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to clear mocked actions",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/testing/assertion",
        {
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
          timeoutMs: 60000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to run assertion",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
