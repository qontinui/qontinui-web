/**
 * TestCaseEditor - Component for creating and editing test cases
 *
 * Features:
 * - Test case name and description
 * - Input configuration (screenshots, states, variables)
 * - Expected outputs configuration
 * - Assertions builder with multiple types
 * - Run test functionality
 * - Save/cancel with validation
 * - Keyboard shortcuts support
 */

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { TestCase } from "@/services/workflow-testing-service";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { ValidationErrors } from "./test-case-editor-types";
import { buildTestCaseData } from "./test-case-editor-utils";
import {
  useTestCaseBasicInfo,
  useTestCaseInputs,
  useTestCaseExpected,
  useTestCaseAssertions,
  useTestCaseTags,
  useTestCaseUI,
} from "./_hooks";
import { TestCaseHeaderCard } from "./_components/TestCaseHeaderCard";
import { InputConfigCard } from "./_components/InputConfigCard";
import { ExpectedOutputsCard } from "./_components/ExpectedOutputsCard";
import { AssertionsCard } from "./_components/AssertionsCard";
import { AdvancedSettingsCard } from "./_components/AdvancedSettingsCard";
import { ActionFooterCard } from "./_components/ActionFooterCard";

// ============================================================================
// Types
// ============================================================================

export interface TestCaseEditorProps {
  testCase?: TestCase;
  workflow: Workflow;
  onSave: (testCase: TestCase) => void;
  onCancel: () => void;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function TestCaseEditor({
  testCase,
  workflow,
  onSave,
  onCancel,
  className,
}: TestCaseEditorProps) {
  // ========================================================================
  // State (via custom hooks)
  // ========================================================================

  const basicInfo = useTestCaseBasicInfo(testCase);
  const inputs = useTestCaseInputs(testCase);
  const expected = useTestCaseExpected(testCase);
  const assertionsState = useTestCaseAssertions(testCase);
  const tagsState = useTestCaseTags(testCase);
  const ui = useTestCaseUI(testCase);

  // ========================================================================
  // Validation
  // ========================================================================

  const validate = React.useCallback((): boolean => {
    const newErrors: ValidationErrors = {};

    if (!basicInfo.name.trim()) {
      newErrors.name = "Test name is required";
    }

    if (assertionsState.assertions.length === 0) {
      newErrors.assertions = "At least one assertion is required";
    }

    ui.setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [basicInfo.name, assertionsState.assertions, ui]);

  // ========================================================================
  // Helpers
  // ========================================================================

  const getTestCaseData = React.useCallback(
    () =>
      buildTestCaseData({
        existingTestCase: testCase,
        name: basicInfo.name,
        description: basicInfo.description,
        workflowId: workflow.id,
        enabled: basicInfo.enabled,
        inputVariables: inputs.inputVariables,
        initialScreenshots: inputs.initialScreenshots,
        initialStates: inputs.initialStates,
        expectedVariables: expected.expectedVariables,
        assertions: assertionsState.assertions,
        shouldSucceed: expected.shouldSucceed,
        expectedFinalAction: expected.expectedFinalAction,
        maxDuration: expected.maxDuration,
        timeout: ui.timeout,
        tags: tagsState.tags,
      }),
    [
      testCase,
      basicInfo.name,
      basicInfo.description,
      workflow.id,
      basicInfo.enabled,
      inputs.inputVariables,
      inputs.initialScreenshots,
      inputs.initialStates,
      expected.expectedVariables,
      assertionsState.assertions,
      expected.shouldSucceed,
      expected.expectedFinalAction,
      expected.maxDuration,
      ui.timeout,
      tagsState.tags,
    ]
  );

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleSave = React.useCallback(() => {
    if (!validate()) {
      return;
    }
    onSave(getTestCaseData());
  }, [validate, getTestCaseData, onSave]);

  const handleRun = React.useCallback(async () => {
    if (!validate()) {
      return;
    }
    ui.setIsRunning(true);

    try {
      const testCaseData = getTestCaseData();

      // Import the test runner API
      const { runWorkflowTest } = await import("@/lib/api/workflow-testing");

      // Get project ID from workflow or default
      const projectId =
        (workflow as { projectId?: string }).projectId || "default-project";

      // Execute the test
      const result = await runWorkflowTest(testCaseData, workflow, projectId);

      // Store result in test case metadata
      const existingResults =
        (testCase?.metadata?.testResults as unknown[]) || [];
      const updatedResults = [result, ...existingResults].slice(0, 100); // Keep last 100 results

      // Update test case with result
      testCaseData.metadata = {
        ...testCaseData.metadata,
        lastRun: result.endTime,
        testResults: updatedResults,
      };

      // Show result notification
      if (result.passed) {
        console.log("Test passed!", result);
        alert("Test passed! All assertions succeeded.");
      } else {
        console.error("Test failed!", result);
        alert(
          `Test failed: ${result.error || "Some assertions failed"}\n\nCheck console for details.`
        );
      }

      // Save the updated test case
      onSave(testCaseData);
    } catch (error) {
      console.error("Test execution failed:", error);
      alert(
        `Test execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      ui.setIsRunning(false);
    }
  }, [validate, getTestCaseData, workflow, testCase, onSave, ui]);

  // ========================================================================
  // Keyboard shortcuts
  // ========================================================================

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Escape to cancel
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleRun();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleRun, onCancel]);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className={cn("space-y-6", className)}>
      <TestCaseHeaderCard
        isEditing={!!testCase}
        name={basicInfo.name}
        onNameChange={basicInfo.setName}
        description={basicInfo.description}
        onDescriptionChange={basicInfo.setDescription}
        tags={tagsState.tags}
        newTag={tagsState.newTag}
        onNewTagChange={tagsState.setNewTag}
        onAddTag={tagsState.addTag}
        onRemoveTag={tagsState.removeTag}
        errors={ui.errors}
      />

      <InputConfigCard
        expanded={ui.expandedSections.input}
        onToggle={() => ui.toggleSection("input")}
        inputVariables={inputs.inputVariables}
        onAddInputVariable={inputs.addInputVariable}
        onRemoveInputVariable={inputs.removeInputVariable}
        initialScreenshots={inputs.initialScreenshots}
        onScreenshotsChange={inputs.setInitialScreenshots}
        initialStates={inputs.initialStates}
        onStatesChange={inputs.setInitialStates}
      />

      <ExpectedOutputsCard
        expanded={ui.expandedSections.expected}
        onToggle={() => ui.toggleSection("expected")}
        shouldSucceed={expected.shouldSucceed}
        onShouldSucceedChange={expected.setShouldSucceed}
        expectedFinalAction={expected.expectedFinalAction}
        onExpectedFinalActionChange={expected.setExpectedFinalAction}
        maxDuration={expected.maxDuration}
        onMaxDurationChange={expected.setMaxDuration}
        expectedVariables={expected.expectedVariables}
        onAddExpectedVariable={expected.addExpectedVariable}
        onRemoveExpectedVariable={expected.removeExpectedVariable}
        workflow={workflow}
      />

      <AssertionsCard
        expanded={ui.expandedSections.assertions}
        onToggle={() => ui.toggleSection("assertions")}
        assertions={assertionsState.assertions}
        onAddAssertion={assertionsState.addAssertion}
        onUpdateAssertion={assertionsState.updateAssertion}
        onRemoveAssertion={assertionsState.removeAssertion}
        errors={ui.errors}
      />

      <AdvancedSettingsCard
        expanded={ui.expandedSections.advanced}
        onToggle={() => ui.toggleSection("advanced")}
        timeout={ui.timeout}
        onTimeoutChange={ui.setTimeout}
        enabled={basicInfo.enabled}
        onEnabledChange={basicInfo.setEnabled}
      />

      <ActionFooterCard
        isRunning={ui.isRunning}
        onRun={handleRun}
        onSave={handleSave}
        onCancel={onCancel}
      />

      {/* Keyboard shortcuts hint */}
      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>
          Keyboard shortcuts: Ctrl+S to save, Esc to cancel, Ctrl+Enter to run
        </p>
      </div>
    </div>
  );
}
