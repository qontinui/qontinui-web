import React from "react";
import type { AIGenerationDialogProps } from "./AIGenerationDialog.types";
import { useAIGeneration } from "./_hooks/use-ai-generation";
import { AIGenerationHeader } from "./_components/AIGenerationHeader";
import { AIGenerationInputPanel } from "./_components/AIGenerationInputPanel";
import { AIGenerationPreviewPanel } from "./_components/AIGenerationPreviewPanel";

export type { AIGenerationDialogProps };

export function AIGenerationDialog({
  isOpen,
  onClose,
  onAccept,
  existingWorkflow,
  initialPrompt = "",
}: AIGenerationDialogProps) {
  const {
    description,
    setDescription,
    state,
    result,
    error,
    selectedAlternative,
    setSelectedAlternative,
    refinementInput,
    setRefinementInput,
    showExamples,
    useExistingWorkflow,
    setUseExistingWorkflow,
    selectedTemplates,
    toggleTemplate,
    textAreaRef,
    currentWorkflow,
    confidence,
    handleGenerate,
    handleRefine,
    handleAccept,
    handleTemplateSelect,
  } = useAIGeneration({
    isOpen,
    initialPrompt,
    existingWorkflow,
    onAccept,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="relative w-full max-w-6xl h-[90vh] bg-white dark:bg-surface-canvas rounded-lg shadow-2xl flex flex-col"
        data-ui-id="dialog-ai-generation"
      >
        <AIGenerationHeader onClose={onClose} />

        <div className="flex-1 overflow-hidden flex">
          <AIGenerationInputPanel
            description={description}
            setDescription={setDescription}
            state={state}
            error={error}
            showExamples={showExamples}
            useExistingWorkflow={useExistingWorkflow}
            setUseExistingWorkflow={setUseExistingWorkflow}
            selectedTemplates={selectedTemplates}
            toggleTemplate={toggleTemplate}
            existingWorkflow={existingWorkflow}
            textAreaRef={textAreaRef}
            onGenerate={handleGenerate}
            onTemplateSelect={handleTemplateSelect}
          />

          <AIGenerationPreviewPanel
            state={state}
            result={result}
            currentWorkflow={currentWorkflow}
            confidence={confidence}
            selectedAlternative={selectedAlternative}
            setSelectedAlternative={setSelectedAlternative}
            refinementInput={refinementInput}
            setRefinementInput={setRefinementInput}
            onRefine={handleRefine}
            onAccept={handleAccept}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
