/**
 * API client for workflow testing backend endpoints
 */

import type { TestCase, TestResult } from "@/services/workflow-testing-service";
import type { Workflow } from "@/lib/action-schema/action-types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Execute a workflow test case
 */
export async function runWorkflowTest(
  testCase: TestCase,
  workflow: Workflow,
  projectId: string
): Promise<TestResult> {
  // Create a test run
  const runResponse = await fetch(`${API_BASE_URL}/api/v1/testing/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({
      project_id: projectId,
      run_name: `Test: ${testCase.name}`,
      description: testCase.description,
      runner_metadata: {
        runner_version: "web-frontend",
        test_case_id: testCase.id,
      },
      workflow_metadata: {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        total_actions: workflow.actions?.length || 0,
      },
      configuration_snapshot: {
        test_case: testCase,
        timeout: testCase.config.timeout || 60000,
      },
    }),
  });

  if (!runResponse.ok) {
    const error = await runResponse.json();
    throw new Error(error.detail || "Failed to create test run");
  }

  const runData = await runResponse.json();
  const runId = runData.run_id;

  const startTime = new Date().toISOString();

  try {
    // Execute workflow with test inputs
    // NOTE: This is a simplified version - real execution would use the runner
    // For now, we'll simulate execution and evaluate assertions
    const executionResult = await executeWorkflowWithInputs(
      workflow,
      testCase.config.inputs || {}
    );

    // Evaluate assertions
    const assertionResults = testCase.config.assertions.map((assertion) => {
      const actualValue = getValueByPath(
        executionResult.variables,
        assertion.path || ""
      );
      const passed = evaluateAssertion(assertion, actualValue);

      return {
        assertion,
        passed,
        actualValue,
        error: passed
          ? undefined
          : `Assertion failed: ${assertion.description}`,
      };
    });

    const allAssertionsPassed = assertionResults.every((r) => r.passed);
    const endTime = new Date().toISOString();
    const duration =
      new Date(endTime).getTime() - new Date(startTime).getTime();

    // Complete the test run
    await fetch(`${API_BASE_URL}/api/v1/testing/runs/${runId}/complete`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({
        status: allAssertionsPassed ? "completed" : "failed",
        ended_at: endTime,
        final_metrics: {
          total_transitions_executed: executionResult.actionsExecuted || 0,
          successful_transitions: allAssertionsPassed
            ? executionResult.actionsExecuted || 0
            : 0,
          failed_transitions: allAssertionsPassed ? 0 : 1,
          coverage_percentage: 0,
          total_deficiencies_found: allAssertionsPassed ? 0 : 1,
        },
        summary: allAssertionsPassed
          ? "All assertions passed"
          : "Some assertions failed",
      }),
    });

    // Return test result
    return {
      id: `result-${Date.now()}`,
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      workflowId: workflow.id,
      workflowName: workflow.name || "",
      passed: allAssertionsPassed,
      startTime,
      endTime,
      duration,
      assertions: assertionResults,
      executionPath: executionResult.executionPath || [],
      finalState: {
        variables: executionResult.variables || {},
        activeStates: executionResult.activeStates || [],
      },
      actionsExecuted: executionResult.actionsExecuted || 0,
      actionsSucceeded: allAssertionsPassed
        ? executionResult.actionsExecuted || 0
        : 0,
    };
  } catch (error) {
    const endTime = new Date().toISOString();
    const duration =
      new Date(endTime).getTime() - new Date(startTime).getTime();

    // Mark test run as failed
    await fetch(`${API_BASE_URL}/api/v1/testing/runs/${runId}/complete`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({
        status: "failed",
        ended_at: endTime,
        final_metrics: {
          total_transitions_executed: 0,
          successful_transitions: 0,
          failed_transitions: 1,
          coverage_percentage: 0,
          total_deficiencies_found: 1,
        },
        summary: error instanceof Error ? error.message : "Unknown error",
      }),
    });

    return {
      id: `result-${Date.now()}`,
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      workflowId: workflow.id,
      workflowName: workflow.name || "",
      passed: false,
      startTime,
      endTime,
      duration,
      assertions: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Simulate workflow execution with inputs
 * NOTE: This is a simplified version - real execution would be done by the runner
 */
async function executeWorkflowWithInputs(
  workflow: Workflow,
  inputs: Record<string, unknown>
): Promise<{
  variables: Record<string, unknown>;
  executionPath: string[];
  activeStates: string[];
  actionsExecuted: number;
}> {
  // Simulate workflow execution
  // In a real implementation, this would execute the workflow through the runner
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    variables: { ...inputs, result: "simulated_execution" },
    executionPath:
      workflow.actions?.slice(0, 3).map((a: unknown) => (a as { id: string }).id) || [],
    activeStates: [],
    actionsExecuted: Math.min(3, workflow.actions?.length || 0),
  };
}

/**
 * Evaluate an assertion against a value
 */
function evaluateAssertion(assertion: unknown, actualValue: unknown): boolean {
  const assertionObj = assertion as Record<string, unknown>;
  switch (assertionObj.type) {
    case "equals":
      return deepEquals(actualValue, assertionObj.expected);
    case "notEquals":
      return !deepEquals(actualValue, assertionObj.expected);
    case "exists":
      return actualValue !== undefined && actualValue !== null;
    case "notExists":
      return actualValue === undefined || actualValue === null;
    case "contains":
      if (Array.isArray(actualValue)) {
        return actualValue.includes(assertionObj.expected);
      } else if (typeof actualValue === "string") {
        return actualValue.includes(assertionObj.expected as string);
      }
      return false;
    case "notContains":
      if (Array.isArray(actualValue)) {
        return !actualValue.includes(assertionObj.expected);
      } else if (typeof actualValue === "string") {
        return !actualValue.includes(assertionObj.expected as string);
      }
      return true;
    case "greaterThan":
      return (
        typeof actualValue === "number" && typeof assertionObj.expected === "number" && actualValue > assertionObj.expected
      );
    case "lessThan":
      return (
        typeof actualValue === "number" && typeof assertionObj.expected === "number" && actualValue < assertionObj.expected
      );
    case "regex":
      if (assertionObj.pattern && typeof assertionObj.pattern === "string") {
        const regex = new RegExp(assertionObj.pattern);
        return regex.test(String(actualValue));
      }
      return false;
    default:
      return false;
  }
}

/**
 * Get value from object by path
 */
function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Deep equality check
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEquals(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * Get authentication token from localStorage
 */
function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("auth_token") || "";
}
