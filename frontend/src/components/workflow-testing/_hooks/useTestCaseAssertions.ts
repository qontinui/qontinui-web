import * as React from "react";
import type { TestCase, Assertion } from "@/services/workflow-testing";

export function useTestCaseAssertions(testCase?: TestCase) {
  const [assertions, setAssertions] = React.useState<Assertion[]>(
    testCase?.config.assertions || []
  );

  const addAssertion = React.useCallback(() => {
    const newAssertion: Assertion = {
      id: `assertion-${Date.now()}`,
      type: "equals",
      description: "",
      path: "",
      expected: "",
    };
    setAssertions((prev) => [...prev, newAssertion]);
  }, []);

  const updateAssertion = React.useCallback(
    (id: string, updates: Partial<Assertion>) => {
      setAssertions((prev) =>
        prev.map((assertion) =>
          assertion.id === id ? { ...assertion, ...updates } : assertion
        )
      );
    },
    []
  );

  const removeAssertion = React.useCallback((id: string) => {
    setAssertions((prev) => prev.filter((assertion) => assertion.id !== id));
  }, []);

  return {
    assertions,
    setAssertions,
    addAssertion,
    updateAssertion,
    removeAssertion,
  };
}
