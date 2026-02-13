import * as React from "react";
import type { TestCase } from "@/services/workflow-testing";

export function useTestCaseBasicInfo(testCase?: TestCase) {
  const [name, setName] = React.useState(testCase?.name || "");
  const [description, setDescription] = React.useState(
    testCase?.description || ""
  );
  const [enabled, setEnabled] = React.useState(testCase?.enabled !== false);

  return {
    name,
    setName,
    description,
    setDescription,
    enabled,
    setEnabled,
  };
}
