"use client";

import { useRunnerHealth, useGuiLock } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Loader2 } from "lucide-react";
import { useWorkflowSelection } from "./_hooks/useWorkflowSelection";
import { useWorkflowExecution } from "./_hooks/useWorkflowExecution";
import { useToolkitState } from "./_hooks/useToolkitState";
import { useAdvancedSettings } from "./_hooks/useAdvancedSettings";
import { PageHeader } from "./_components/PageHeader";
import { ConfigStatusCard } from "./_components/ConfigStatusCard";
import { MonitorSelector } from "./_components/MonitorSelector";
import { GuiLockStatusCard } from "./_components/GuiLockStatusCard";
import { WorkflowSelectionCard } from "./_components/WorkflowSelectionCard";
import { AdvancedSettingsCard } from "./_components/AdvancedSettingsCard";
import { RunActionCard } from "./_components/RunActionCard";
import { RunResultCard } from "./_components/RunResultCard";
import { EmptyStateCard } from "./_components/EmptyStateCard";
import { ToolkitPanel } from "./_components/ToolkitPanel";

export default function ExecuteVisualAutomationPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const { data: guiLock } = useGuiLock();
  const isGuiLocked = guiLock?.holder_id != null;

  const {
    workflowsLoading,
    workflowsError,
    searchQuery,
    setSearchQuery,
    selectedWorkflowId,
    setSelectedWorkflowId,
    filteredWorkflows,
    selectedWorkflow,
  } = useWorkflowSelection();

  const { isRunning, runResult, handleRun } = useWorkflowExecution();

  const toolkit = useToolkitState();

  const {
    selectedMonitor,
    setSelectedMonitor,
    showAdvanced,
    toggleAdvanced,
    initialStates,
    setInitialStates,
    autoMinimize,
    setAutoMinimize,
  } = useAdvancedSettings();

  if (healthLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <PageHeader
        isGuiLocked={isGuiLocked}
        showToolkit={toolkit.showToolkit}
        onToggleToolkit={toolkit.toggleToolkit}
      />

      <main
        className="flex-1 overflow-y-auto p-6 mx-auto flex gap-6 w-full"
        style={{ maxWidth: toolkit.showToolkit ? "1200px" : "896px" }}
      >
        <div className="flex-1 space-y-6">
          {isOffline && (
            <RunnerPartialState message="Runner offline — this tool requires the runner for execution" />
          )}

          <ConfigStatusCard
            selectedWorkflow={selectedWorkflow}
            onUnload={() => setSelectedWorkflowId(null)}
          />

          <MonitorSelector
            selectedMonitor={selectedMonitor}
            onMonitorChange={setSelectedMonitor}
          />

          {guiLock && <GuiLockStatusCard isGuiLocked={isGuiLocked} />}

          <WorkflowSelectionCard
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            workflowsLoading={workflowsLoading}
            workflowsError={workflowsError}
            filteredWorkflows={filteredWorkflows}
            selectedWorkflowId={selectedWorkflowId}
            onSelectWorkflow={setSelectedWorkflowId}
          />

          <AdvancedSettingsCard
            showAdvanced={showAdvanced}
            onToggleAdvanced={toggleAdvanced}
            initialStates={initialStates}
            onInitialStatesChange={setInitialStates}
            autoMinimize={autoMinimize}
            onAutoMinimizeChange={setAutoMinimize}
          />

          {selectedWorkflow && (
            <RunActionCard
              workflow={selectedWorkflow}
              isRunning={isRunning}
              isGuiLocked={isGuiLocked}
              onRun={() => handleRun(selectedWorkflow.id)}
            />
          )}

          {runResult && <RunResultCard result={runResult} />}

          {!selectedWorkflow && !runResult && <EmptyStateCard />}
        </div>

        {toolkit.showToolkit && (
          <ToolkitPanel
            toolkitTab={toolkit.toolkitTab}
            onTabChange={toolkit.setToolkitTab}
            clickType={toolkit.clickType}
            onClickTypeChange={toolkit.setClickType}
            typeText={toolkit.typeText}
            onTypeTextChange={toolkit.setTypeText}
            hotkeyInput={toolkit.hotkeyInput}
            onHotkeyInputChange={toolkit.setHotkeyInput}
            selectedWorkflow={selectedWorkflow}
          />
        )}
      </main>
    </div>
  );
}
