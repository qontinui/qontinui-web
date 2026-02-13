import * as React from "react";
import type { TestCase } from "@/services/workflow-testing";

export function useTestCaseExpected(testCase?: TestCase) {
  const [expectedVariables, setExpectedVariables] = React.useState<
    Record<string, unknown>
  >(testCase?.config.initialState?.variables || {});
  const [expectedFinalAction, setExpectedFinalAction] = React.useState<string>(
    testCase?.config.expected?.finalActionId || ""
  );
  const [maxDuration, setMaxDuration] = React.useState<number>(
    testCase?.config.expected?.maxDuration || 30000
  );
  const [shouldSucceed, setShouldSucceed] = React.useState<boolean>(
    testCase?.config.expected?.shouldSucceed !== false
  );

  const addExpectedVariable = React.useCallback(
    (key: string, value: unknown) => {
      setExpectedVariables((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const removeExpectedVariable = React.useCallback((key: string) => {
    setExpectedVariables((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    expectedVariables,
    setExpectedVariables,
    expectedFinalAction,
    setExpectedFinalAction,
    maxDuration,
    setMaxDuration,
    shouldSucceed,
    setShouldSucceed,
    addExpectedVariable,
    removeExpectedVariable,
  };
}
