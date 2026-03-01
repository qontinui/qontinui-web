"use client";

import React from "react";
import { SpecSourceSection } from "./SpecSourceSection";
import { useGenerateFormState } from "./_hooks/useGenerateFormState";
import { useAdvancedOptions } from "./_hooks/useAdvancedOptions";
import { useTemplates } from "./_hooks/useTemplates";
import { useGenerateRequests } from "./_hooks/useGenerateRequests";
import { GeneratePanelHeader } from "./_components/GeneratePanelHeader";
import { DescriptionSection } from "./_components/DescriptionSection";
import { ContextSection } from "./_components/ContextSection";
import { AdvancedOptionsSection } from "./_components/AdvancedOptionsSection";
import { GeneratePanelFooter } from "./_components/GeneratePanelFooter";

// Re-export types and constants for external consumers
export {
  AUTO_RUN_AFTER_GENERATE_KEY,
  type AutoRunAfterGenerate,
  type AiGeneratePanelProps,
} from "./ai-generate-types";

// =============================================================================
// AiGeneratePanel Component
// =============================================================================

export function AiGeneratePanel({
  onCreateManually,
  isCreatingManually,
  onNavigateToActiveRuns,
}: {
  onCreateManually: () => void;
  isCreatingManually: boolean;
  onNavigateToActiveRuns: (taskRunId: string) => void;
}) {
  const formState = useGenerateFormState();
  const advancedOptions = useAdvancedOptions();
  const templates = useTemplates();

  const { canGenerate, handleGenerate, handleGenerateAndRun } =
    useGenerateRequests({
      // Form state
      description: formState.description,
      selectedContextIds: formState.selectedContextIds,
      inlineContext: formState.inlineContext,
      specState: formState.specState,
      hasSpecs: formState.hasSpecs,
      isBatchMode: formState.isBatchMode,

      // Advanced options
      category: advancedOptions.category,
      tagsInput: advancedOptions.tagsInput,
      maxIterations: advancedOptions.maxIterations,
      provider: advancedOptions.provider,
      model: advancedOptions.model,
      maxFixIterations: advancedOptions.maxFixIterations,
      autoIncludeContexts: advancedOptions.autoIncludeContexts,
      discoveryMode: advancedOptions.discoveryMode,
      includeUIBridge: advancedOptions.includeUIBridge,
      reflectionMode: advancedOptions.reflectionMode,
      investigateCodebase: advancedOptions.investigateCodebase,
      includeDesignGuidance: advancedOptions.includeDesignGuidance,

      // Actions
      setSubmittingAction: formState.setSubmittingAction,
      onNavigateToActiveRuns,
    });

  const handleApplyTemplate = (
    template: Parameters<typeof templates.handleApplyTemplate>[0]
  ) => {
    templates.handleApplyTemplate(
      template,
      formState.setDescription,
      advancedOptions.setDiscoveryMode,
      advancedOptions.setCategory,
      advancedOptions.setTagsInput,
      advancedOptions.setShowAdvanced,
      advancedOptions.setIncludeDesignGuidance
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <GeneratePanelHeader
        onCreateManually={onCreateManually}
        isCreatingManually={isCreatingManually}
        submittingAction={formState.submittingAction}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {/* Description */}
          <DescriptionSection
            description={formState.description}
            setDescription={formState.setDescription}
            hasSpecs={formState.hasSpecs}
            showTemplates={templates.showTemplates}
            setShowTemplates={templates.setShowTemplates}
            isSavingTemplate={templates.isSavingTemplate}
            generationPrompts={templates.generationPrompts}
            onApplyTemplate={handleApplyTemplate}
            onSaveAsTemplate={() =>
              templates.handleSaveAsTemplate(formState.description)
            }
            onDeleteTemplate={templates.handleDeleteSavedTemplate}
          />

          {/* Page Specs Section */}
          <SpecSourceSection onSpecsChanged={formState.setSpecState} />

          {/* Context Section */}
          <ContextSection
            showContext={formState.showContext}
            setShowContext={formState.setShowContext}
            selectedContextIds={formState.selectedContextIds}
            savedContexts={formState.savedContexts}
            contextsByScope={formState.contextsByScope}
            handleContextToggle={formState.handleContextToggle}
            inlineContext={formState.inlineContext}
            setInlineContext={formState.setInlineContext}
            filePath={formState.filePath}
            setFilePath={formState.setFilePath}
            isImportingFile={formState.isImportingFile}
            handleImportFile={formState.handleImportFile}
          />

          {/* Advanced Options */}
          <AdvancedOptionsSection {...advancedOptions} />
        </div>
      </div>

      {/* Actions - fixed footer */}
      <GeneratePanelFooter
        canGenerate={canGenerate}
        submittingAction={formState.submittingAction}
        isBatchMode={formState.isBatchMode}
        batchPageCount={formState.batchPageCount}
        onGenerate={handleGenerate}
        onGenerateAndRun={handleGenerateAndRun}
      />
    </div>
  );
}
