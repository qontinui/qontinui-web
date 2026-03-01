"use client";

/**
 * Test Orchestrator
 *
 * AI-driven multi-step API test orchestration component for the web frontend.
 * Guides users through 4 phases:
 *   1. Selection  - Choose saved API requests to chain
 *   2. Planning   - AI creates execution plan with variable chaining
 *   3. Execution  - Run orchestrated test steps with live progress
 *   4. Generation - AI generates test code from execution results
 */

import { Button } from "@/components/ui/button";
import {
  Play,
  Sparkles,
  Check,
  AlertCircle,
  ChevronLeft,
  Trash2,
  FileCode,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestOrchestratorProps } from "./_types/orchestrator-types";
import { useTestOrchestrator } from "./_hooks/useTestOrchestrator";
import { PhaseIndicator } from "./_components/PhaseIndicator";
import { SelectionPhase } from "./_components/SelectionPhase";
import { PlanningPhase } from "./_components/PlanningPhase";
import { ExecutionPhase } from "./_components/ExecutionPhase";
import { GenerationPhase } from "./_components/GenerationPhase";

export function TestOrchestrator({
  onTestGenerated,
  className,
}: TestOrchestratorProps) {
  const {
    phase,
    filteredRequests,
    selectedRequestIds,
    searchQuery,
    setSearchQuery,
    loadingRequests,
    availableRequests,
    testDescription,
    setTestDescription,
    additionalContext,
    setAdditionalContext,
    testType,
    setTestType,
    toggleRequest,
    selectAll,
    clearSelection,
    plan,
    planning,
    executionResult,
    executing,
    currentStepIndex,
    generatedTest,
    generating,
    error,
    setError,
    canAdvance,
    canGoBack,
    advancePhase,
    goBack,
    reset,
    copyCode,
  } = useTestOrchestrator({ onTestGenerated });

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border-subtle/50 rounded-lg bg-surface-raised/20 overflow-hidden",
        className
      )}
    >
      {/* Phase Indicator Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle/30 bg-surface-raised/40">
        <PhaseIndicator currentPhase={phase} />
        <div className="flex-1" />
        {phase !== "selection" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="gap-1.5 text-text-muted"
          >
            <Trash2 className="size-3.5" />
            Reset
          </Button>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
          <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400 flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-400/50 hover:text-red-400"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {phase === "selection" && (
          <SelectionPhase
            requests={filteredRequests}
            selectedIds={selectedRequestIds}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onToggle={toggleRequest}
            onSelectAll={selectAll}
            onClear={clearSelection}
            loadingRequests={loadingRequests}
            totalAvailable={availableRequests.length}
            testDescription={testDescription}
            onDescriptionChange={setTestDescription}
            additionalContext={additionalContext}
            onContextChange={setAdditionalContext}
            testType={testType}
            onTestTypeChange={setTestType}
          />
        )}

        {phase === "planning" && (
          <PlanningPhase
            plan={plan}
            planning={planning}
            selectedCount={selectedRequestIds.size}
          />
        )}

        {phase === "execution" && (
          <ExecutionPhase
            plan={plan}
            executionResult={executionResult}
            executing={executing}
            currentStepIndex={currentStepIndex}
          />
        )}

        {phase === "generation" && (
          <GenerationPhase
            generatedTest={generatedTest}
            generating={generating}
            testType={testType}
            onCopyCode={copyCode}
          />
        )}
      </div>

      {/* Footer with Navigation */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle/30 bg-surface-raised/40">
        {canGoBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={goBack}
            className="gap-1.5"
          >
            <ChevronLeft className="size-3.5" />
            Back
          </Button>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={advancePhase}
          disabled={!canAdvance || planning || executing || generating}
          className={cn(
            "gap-1.5",
            phase === "generation"
              ? "bg-purple-600 hover:bg-purple-700 text-white"
              : ""
          )}
        >
          {(planning || executing || generating) && (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          {!planning && !executing && !generating && (
            <>
              {phase === "selection" && (
                <>
                  <Sparkles className="size-3.5" />
                  Create Plan
                </>
              )}
              {phase === "planning" && (
                <>
                  <Play className="size-3.5" />
                  Execute Plan
                </>
              )}
              {phase === "execution" && (
                <>
                  <FileCode className="size-3.5" />
                  Generate Test
                </>
              )}
              {phase === "generation" && (
                <>
                  <Check className="size-3.5" />
                  Apply to Test
                </>
              )}
            </>
          )}
          {planning && "Creating Plan..."}
          {executing && "Executing..."}
          {generating && "Generating..."}
        </Button>
      </div>
    </div>
  );
}
