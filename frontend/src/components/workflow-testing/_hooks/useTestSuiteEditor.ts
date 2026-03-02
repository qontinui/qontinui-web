import * as React from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { TestSuite, TestCase } from "@/services/workflow-testing-service";
import type { TestSuiteValidationErrors } from "../test-suite-editor-types";

export function useTestSuiteEditor(
  suite: TestSuite | undefined,
  availableTestCases: TestCase[],
  onSave: (suite: TestSuite) => void,
  onCancel: () => void
) {
  const [name, setName] = React.useState(suite?.name || "");
  const [description, setDescription] = React.useState(
    suite?.description || ""
  );
  const [executionOrder, setExecutionOrder] = React.useState<
    "parallel" | "sequential"
  >(suite?.executionOrder || "sequential");
  const [stopOnFailure, setStopOnFailure] = React.useState(
    suite?.stopOnFailure || false
  );
  const [tags, setTags] = React.useState<string[]>(suite?.tags || []);
  const [newTag, setNewTag] = React.useState("");
  const [selectedTestCaseIds, setSelectedTestCaseIds] = React.useState<
    string[]
  >(suite?.testCaseIds || []);
  const [errors, setErrors] = React.useState<TestSuiteValidationErrors>({});

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const selectedTestCases = React.useMemo(() => {
    return selectedTestCaseIds
      .map((id) => availableTestCases.find((tc) => tc.id === id))
      .filter((tc): tc is TestCase => tc !== undefined);
  }, [selectedTestCaseIds, availableTestCases]);

  const unselectedTestCases = React.useMemo(() => {
    return availableTestCases.filter(
      (tc) => !selectedTestCaseIds.includes(tc.id)
    );
  }, [availableTestCases, selectedTestCaseIds]);

  const validate = React.useCallback((): boolean => {
    const newErrors: TestSuiteValidationErrors = {};

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
    if (!validate()) {
      return;
    }

    const suiteData: TestSuite = {
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

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = selectedTestCaseIds.indexOf(active.id as string);
        const newIndex = selectedTestCaseIds.indexOf(over.id as string);

        setSelectedTestCaseIds(
          arrayMove(selectedTestCaseIds, oldIndex, newIndex)
        );
      }
    },
    [selectedTestCaseIds]
  );

  const addTag = React.useCallback(() => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags((prev) => [...prev, newTag.trim()]);
      setNewTag("");
    }
  }, [newTag, tags]);

  const removeTag = React.useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const addTestCase = React.useCallback((testCaseId: string) => {
    setSelectedTestCaseIds((prev) => [...prev, testCaseId]);
  }, []);

  const removeTestCase = React.useCallback((testCaseId: string) => {
    setSelectedTestCaseIds((prev) => prev.filter((id) => id !== testCaseId));
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, onCancel]);

  return {
    name,
    setName,
    description,
    setDescription,
    executionOrder,
    setExecutionOrder,
    stopOnFailure,
    setStopOnFailure,
    tags,
    newTag,
    setNewTag,
    selectedTestCaseIds,
    errors,
    sensors,
    selectedTestCases,
    unselectedTestCases,
    handleSave,
    handleDragEnd,
    addTag,
    removeTag,
    addTestCase,
    removeTestCase,
  };
}
