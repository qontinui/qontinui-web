"use client";

import { useCallback } from "react";
import { TestTube2, Workflow } from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import type { RunnerTest } from "@/components/builders/hooks/useRunnerEntity";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { TestType } from "@/types/unified-workflow";
import { TEST_TYPES } from "./test-config";
import { useTestsPage } from "./_hooks/useTestsPage";
import { TestListItem } from "./_components/TestListItem";
import { TestEditor } from "./_components/TestEditor";

export default function TestsPage() {
  const isDev = process.env.NODE_ENV === "development";
  const visibleTestTypes = isDev
    ? TEST_TYPES
    : TEST_TYPES.filter((t) => !("devOnly" in t && t.devOnly));

  const {
    // Data
    tests,
    isLoading,
    error,
    isOffline,
    selectedItem,
    form,
    setForm,
    isDirty,
    isNew,
    isSaving,
    // UI state
    addToWorkflowStep,
    setAddToWorkflowStep,
    aiGenerating,
    aiResult,
    aiError,
    aiMetadataGenerating,
    screenshotModalUrl,
    setScreenshotModalUrl,
    editorTab,
    setEditorTab,
    analysisElements,
    fileInputRef,
    // AI templates
    currentAiTemplates,
    // Actions
    onSelect,
    onNew,
    batchDelete,
    builderRefetch,
    handleDuplicateTest,
    handleTestTypeChange,
    handleAiGenerate,
    handleAiAccept,
    handleFillMetadataWithAi,
    handleExport,
    handleImport,
    handleExecuteTest,
    handleSave,
    handleDelete,
    handleAnalysisComplete,
    handleApplyTestCode,
  } = useTestsPage();

  // List item renderer
  const renderListItem = (item: RunnerTest) => (
    <TestListItem item={item} />
  );

  // List action renderer (insert into workflow button)
  const renderListActions = useCallback(
    (item: RunnerTest) => {
      const testTypeMap: Record<string, string> = {
        python_script: "python",
        qontinui_vision: "qontinui_vision",
        repository_test: "repository",
      };
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
          title="Insert into Workflow"
          onClick={() => {
            setAddToWorkflowStep({
              type: "command",
              name: item.name,
              test_type: (testTypeMap[item.test_type] || "custom_command") as TestType,
              test_id: item.id,
            });
          }}
        >
          <Workflow className="size-3.5" />
        </Button>
      );
    },
    [setAddToWorkflowStep]
  );

  // Editor renderer
  const renderEditor = (item: RunnerTest) => (
    <TestEditor
      item={item}
      form={form}
      setForm={setForm}
      isDirty={isDirty}
      isNew={isNew}
      isSaving={isSaving}
      isOffline={isOffline}
      selectedItem={selectedItem}
      visibleTestTypes={visibleTestTypes}
      editorTab={editorTab}
      setEditorTab={setEditorTab}
      analysisElements={analysisElements}
      fileInputRef={fileInputRef}
      aiGenerating={aiGenerating}
      aiResult={aiResult}
      aiError={aiError}
      aiMetadataGenerating={aiMetadataGenerating}
      currentAiTemplates={currentAiTemplates}
      screenshotModalUrl={screenshotModalUrl}
      setScreenshotModalUrl={setScreenshotModalUrl}
      handleSave={handleSave}
      handleDelete={handleDelete}
      handleDuplicateTest={handleDuplicateTest}
      handleTestTypeChange={handleTestTypeChange}
      handleFillMetadataWithAi={handleFillMetadataWithAi}
      handleExport={handleExport}
      handleImport={handleImport}
      handleExecuteTest={handleExecuteTest}
      handleAiGenerate={handleAiGenerate}
      handleAiAccept={handleAiAccept}
      handleAnalysisComplete={handleAnalysisComplete}
      handleApplyTestCode={handleApplyTestCode}
    />
  );

  return (
    <>
      <BuilderLayout
        title="Tests"
        icon={TestTube2}
        iconColor="text-emerald-400"
        accentColor="emerald"
        items={tests}
        isLoading={isLoading}
        error={error ? String(error) : null}
        isOffline={isOffline}
        selectedItem={selectedItem}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={batchDelete}
        refetch={builderRefetch}
        renderListItem={renderListItem}
        renderListActions={renderListActions}
        renderEditor={renderEditor}
        emptyIcon={TestTube2}
        emptyTitle="No tests yet"
        emptyDescription="Create automated tests"
        itemLabel="test"
        searchPlaceholder="Search tests..."
      />

      <AddToWorkflowDialog
        open={addToWorkflowStep !== null}
        onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
        stepData={addToWorkflowStep ?? {}}
      />
    </>
  );
}
