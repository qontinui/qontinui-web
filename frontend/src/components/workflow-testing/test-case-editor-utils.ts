/**
 * Pure utility functions for TestCaseEditor.
 */

import type { TestCase, Assertion } from "@/services/workflow-testing-service";

/**
 * Build a TestCase data object from the editor's current state.
 * Used by both save and run handlers.
 */
export function buildTestCaseData(params: {
  existingTestCase?: TestCase;
  name: string;
  description: string;
  workflowId: string;
  enabled: boolean;
  inputVariables: Record<string, unknown>;
  initialScreenshots: string[];
  initialStates: string[];
  expectedVariables: Record<string, unknown>;
  assertions: Assertion[];
  shouldSucceed: boolean;
  expectedFinalAction: string;
  maxDuration: number;
  timeout: number;
  tags: string[];
}): TestCase {
  const {
    existingTestCase,
    name,
    description,
    workflowId,
    enabled,
    inputVariables,
    initialScreenshots,
    initialStates,
    expectedVariables,
    assertions,
    shouldSucceed,
    expectedFinalAction,
    maxDuration,
    timeout,
    tags,
  } = params;

  return {
    id: existingTestCase?.id || `test-${Date.now()}`,
    name,
    description: description || undefined,
    workflowId,
    enabled,
    config: {
      inputs: inputVariables,
      initialState: {
        screenshots: initialScreenshots,
        activeStates: initialStates,
        variables: expectedVariables,
      },
      assertions,
      expected: {
        shouldSucceed,
        finalActionId: expectedFinalAction || undefined,
        maxDuration,
      },
      timeout,
      tags,
    },
    metadata: {
      ...existingTestCase?.metadata,
      created: existingTestCase?.metadata?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  };
}
