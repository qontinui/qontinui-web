"use client";

import { Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import type { TestSuiteEditorProps } from "./test-suite-editor-types";
import { useTestSuiteEditor } from "./_hooks/useTestSuiteEditor";
import { SuiteDetailsCard } from "./_components/SuiteDetailsCard";
import { TestCaseSelectionCard } from "./_components/TestCaseSelectionCard";

export type { TestSuiteEditorProps };

export function TestSuiteEditor({
  suite,
  availableTestCases,
  onSave,
  onCancel,
  className,
}: TestSuiteEditorProps) {
  const {
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
  } = useTestSuiteEditor(suite, availableTestCases, onSave, onCancel);

  return (
    <div className={cn("space-y-6", className)}>
      <SuiteDetailsCard
        isEditing={!!suite}
        name={name}
        onNameChange={setName}
        description={description}
        onDescriptionChange={setDescription}
        executionOrder={executionOrder}
        onExecutionOrderChange={setExecutionOrder}
        stopOnFailure={stopOnFailure}
        onStopOnFailureChange={setStopOnFailure}
        tags={tags}
        newTag={newTag}
        onNewTagChange={setNewTag}
        onAddTag={addTag}
        onRemoveTag={removeTag}
        errors={errors}
      />

      <TestCaseSelectionCard
        selectedTestCaseIds={selectedTestCaseIds}
        selectedTestCases={selectedTestCases}
        unselectedTestCases={unselectedTestCases}
        sensors={sensors}
        onDragEnd={handleDragEnd}
        onAddTestCase={addTestCase}
        onRemoveTestCase={removeTestCase}
        error={errors.testCases}
      />

      <Card>
        <CardFooter className="flex justify-between">
          <Button onClick={onCancel} variant="outline">
            <X />
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save />
            Save Suite
          </Button>
        </CardFooter>
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        <p>Keyboard shortcuts: Ctrl+S to save, Esc to cancel</p>
      </div>
    </div>
  );
}
