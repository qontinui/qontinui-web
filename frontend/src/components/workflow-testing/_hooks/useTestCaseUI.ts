import * as React from "react";
import type { TestCase } from "@/services/workflow-testing";
import type { ValidationErrors } from "../test-case-editor-types";

export function useTestCaseUI(testCase?: TestCase) {
  const [isRunning, setIsRunning] = React.useState(false);
  const [errors, setErrors] = React.useState<ValidationErrors>({});
  const [expandedSections, setExpandedSections] = React.useState({
    input: true,
    expected: true,
    assertions: true,
    advanced: false,
  });
  const [timeout, setTimeout] = React.useState<number>(
    testCase?.config.timeout || 60000
  );

  const toggleSection = React.useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    []
  );

  return {
    isRunning,
    setIsRunning,
    errors,
    setErrors,
    expandedSections,
    toggleSection,
    timeout,
    setTimeout,
  };
}

export type { ValidationErrors };
