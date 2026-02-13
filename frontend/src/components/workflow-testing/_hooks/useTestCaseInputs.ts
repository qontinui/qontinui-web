import * as React from "react";
import type { TestCase } from "@/services/workflow-testing";

export function useTestCaseInputs(testCase?: TestCase) {
  const [initialScreenshots, setInitialScreenshots] = React.useState<string[]>(
    testCase?.config.initialState?.screenshots || []
  );
  const [initialStates, setInitialStates] = React.useState<string[]>(
    testCase?.config.initialState?.activeStates || []
  );
  const [inputVariables, setInputVariables] = React.useState<
    Record<string, unknown>
  >(testCase?.config.inputs || {});

  const addInputVariable = React.useCallback((key: string, value: unknown) => {
    setInputVariables((prev) => ({ ...prev, [key]: value }));
  }, []);

  const removeInputVariable = React.useCallback((key: string) => {
    setInputVariables((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    initialScreenshots,
    setInitialScreenshots,
    initialStates,
    setInitialStates,
    inputVariables,
    setInputVariables,
    addInputVariable,
    removeInputVariable,
  };
}
