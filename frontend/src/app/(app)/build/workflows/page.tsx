"use client";

import { useState, Suspense } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./workflows.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { WorkflowBuilderProvider } from "@/components/workflow-builder/WorkflowBuilderContext";
import { AiGeneratePanel } from "@/components/workflow-builder/AiGeneratePanel";
import { Button } from "@/components/ui/button";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { WorkflowEditor } from "./_components/WorkflowEditor";
import { WorkflowListSidebar } from "./_components/WorkflowListSidebar";
import { useInsertStep } from "./_hooks/useInsertStep";
import { useWorkflowPageActions } from "./_hooks/useWorkflowPageActions";
import { Workflow } from "lucide-react";

function BuildWorkflowsPageContent() {
  usePageSpecs({ workflows: pageSpec });
  const { isOffline } = useUnifiedWorkflows();
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<UnifiedWorkflow | null>(null);

  const { pendingInsertStep, consumeInsertStep } = useInsertStep(
    selectedWorkflow,
    setSelectedWorkflow,
  );

  const {
    isCreatingManually,
    handleCreateManually,
    handleRunWorkflow,
    handleNavigateToActiveRuns,
  } = useWorkflowPageActions(setSelectedWorkflow);

  return (
    <div className="h-full bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Workflow className="size-5 text-brand-secondary" />
            <h1 className="text-lg font-bold text-text-primary">
              Workflow Builder
            </h1>
          </div>
        </div>
      </header>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <WorkflowListSidebar
          selectedWorkflowId={selectedWorkflow?.id ?? null}
          onSelectWorkflow={setSelectedWorkflow}
          onDeselectWorkflow={() => setSelectedWorkflow(null)}
          onRunWorkflow={handleRunWorkflow}
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          {isOffline ? (
            <RunnerOfflineState />
          ) : selectedWorkflow ? (
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-muted"
                  onClick={() => setSelectedWorkflow(null)}
                >
                  Back to AI Generator
                </Button>
              </div>
              <WorkflowBuilderProvider
                key={selectedWorkflow.id}
                initialWorkflow={selectedWorkflow}
              >
                <WorkflowEditor
                  onRun={() => handleRunWorkflow(selectedWorkflow.id)}
                  pendingInsertStep={pendingInsertStep}
                  onInsertConsumed={consumeInsertStep}
                />
              </WorkflowBuilderProvider>
            </div>
          ) : (
            <AiGeneratePanel
              onCreateManually={handleCreateManually}
              isCreatingManually={isCreatingManually}
              onNavigateToActiveRuns={handleNavigateToActiveRuns}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function BuildWorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <BuildWorkflowsPageContent />
    </Suspense>
  );
}
