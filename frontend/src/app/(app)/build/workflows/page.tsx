"use client";

import { useState, useEffect, Suspense } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import { WorkflowBuilderProvider } from "@/components/workflow-builder/WorkflowBuilderContext";
import { AiGeneratePanel } from "@/components/workflow-builder/AiGeneratePanel";
import { Button } from "@/components/ui/button";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { WorkflowEditor } from "./_components/WorkflowEditor";
import { WorkflowListSidebar } from "./_components/WorkflowListSidebar";
import { useInsertStep } from "./_hooks/useInsertStep";
import { useWorkflowPageActions } from "./_hooks/useWorkflowPageActions";
import { Workflow, Loader2 } from "lucide-react";

function BuildWorkflowsPageContent() {
  const discoveredSpec = useDiscoveredSpec("workflows");
  usePageSpecs(
    discoveredSpec ? { workflows: discoveredSpec.config as SpecConfig } : {}
  );
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<UnifiedWorkflow | null>(null);
  const [isSidebarCreating, setIsSidebarCreating] = useState(false);

  // Load workflow passed from chat page via sessionStorage
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("qontinui:editWorkflow");
      if (stored) {
        sessionStorage.removeItem("qontinui:editWorkflow");
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object" && "setupSteps" in parsed && typeof parsed.id === "string" && parsed.id && typeof parsed.name === "string") {
          setSelectedWorkflow(parsed as UnifiedWorkflow);
        }
      }
    } catch {
      // Ignore malformed data or storage errors
    }
  }, []);

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
          onCreatingChange={setIsSidebarCreating}
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          {selectedWorkflow ? (
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
          ) : isCreatingManually || isSidebarCreating ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="size-6 animate-spin text-text-muted" />
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
