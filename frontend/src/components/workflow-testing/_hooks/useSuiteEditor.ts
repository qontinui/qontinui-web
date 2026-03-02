import * as React from "react";
import type { TestSuite, TestCase } from "@/services/workflow-testing-service";

export function useSuiteEditor(
  suite: TestSuite | null | undefined,
  testCases: TestCase[],
  onSave: (suite: Partial<TestSuite>) => void
) {
  const [name, setName] = React.useState(suite?.name || "");
  const [description, setDescription] = React.useState(
    suite?.description || ""
  );
  const [selectedTestCaseIds, setSelectedTestCaseIds] = React.useState<
    string[]
  >(suite?.testCaseIds || []);
  const [executionOrder, setExecutionOrder] = React.useState<
    "parallel" | "sequential"
  >(suite?.executionOrder || "sequential");
  const [stopOnFailure, setStopOnFailure] = React.useState(
    suite?.stopOnFailure || false
  );
  const [tags, setTags] = React.useState<string[]>(suite?.tags || []);
  const [newTag, setNewTag] = React.useState("");
  const [filterWorkflow, setFilterWorkflow] = React.useState<string>("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const filteredTestCases = React.useMemo(() => {
    if (!filterWorkflow) return testCases;
    return testCases.filter((tc) => tc.workflowId === filterWorkflow);
  }, [testCases, filterWorkflow]);

  const validate = React.useCallback(() => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Suite name is required";
    }

    if (selectedTestCaseIds.length === 0) {
      newErrors.testCases = "At least one test case is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, selectedTestCaseIds]);

  const handleSave = React.useCallback(() => {
    if (!validate()) return;

    const suiteData: Partial<TestSuite> = {
      id: suite?.id || `suite-${Date.now()}`,
      name,
      description: description || undefined,
      testCaseIds: selectedTestCaseIds,
      executionOrder,
      stopOnFailure,
      tags,
      metadata: {
        ...suite?.metadata,
        created: suite?.metadata?.created || new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    onSave(suiteData);
  }, [
    validate,
    suite,
    name,
    description,
    selectedTestCaseIds,
    executionOrder,
    stopOnFailure,
    tags,
    onSave,
  ]);

  const toggleTestCase = React.useCallback((testCaseId: string) => {
    setSelectedTestCaseIds((prev) =>
      prev.includes(testCaseId)
        ? prev.filter((id) => id !== testCaseId)
        : [...prev, testCaseId]
    );
  }, []);

  const addTag = React.useCallback(() => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags((prev) => [...prev, newTag.trim()]);
      setNewTag("");
    }
  }, [newTag, tags]);

  const removeTag = React.useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  return {
    name,
    setName,
    description,
    setDescription,
    selectedTestCaseIds,
    executionOrder,
    setExecutionOrder,
    stopOnFailure,
    setStopOnFailure,
    tags,
    newTag,
    setNewTag,
    filterWorkflow,
    setFilterWorkflow,
    errors,
    filteredTestCases,
    handleSave,
    toggleTestCase,
    addTag,
    removeTag,
  };
}
