// app/(app)/integration-testing/page.tsx

"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SnapshotImportCard } from "@/components/integration-testing/SnapshotImportCard";
import { SnapshotListCard } from "@/components/integration-testing/SnapshotListCard";
import { SmartSnapshotSelector } from "@/components/integration-testing/SmartSnapshotSelector";
import { ExecutionControls } from "@/components/integration-testing/ExecutionControls";
import { ExecutionVisualization } from "@/components/integration-testing/ExecutionVisualization";
import { StateCoveragePanel } from "@/components/integration-testing/StateCoveragePanel";
import { useMockExecution } from "@/hooks/useMockExecution";
import { useAutomation } from "@/contexts/automation-context";
import type { SnapshotRun } from "@/types/snapshots";
import type { ActionSpec } from "@/types/integration-testing";
import { toast } from "sonner";
import { RequireProject } from "@/components/require-project";

export default function IntegrationTestingPage() {
  const [selectedSnapshots, setSelectedSnapshots] = useState<SnapshotRun[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("execute");
  const { result, loading, error, execute, reset } = useMockExecution();
  const { workflows = [] } = useAutomation();

  const handleExecute = async (
    processId: string,
    initialStates: string[],
    snapshotRunIds: string[]
  ) => {
    if (snapshotRunIds.length === 0) {
      toast.error("No snapshots selected");
      return;
    }

    // Find the selected process/workflow
    const process = workflows.find((w) => w.id === processId);
    if (!process) {
      toast.error("Process not found");
      return;
    }

    // Convert workflow actions to ActionSpec format
    const actions: ActionSpec[] =
      process.actions?.map((action: unknown) => ({
        type: action.actionType || action.type || "FIND",
        pattern_id: action.patternId || action.pattern_id,
        text: action.text,
        metadata: action.metadata || {},
      })) || [];

    toast.info("Execution started", {
      description: `Running ${process.name} with ${initialStates.length} initial state(s) using ${snapshotRunIds.length} snapshot(s)`,
    });

    try {
      await execute({
        process_id: processId,
        process_name: process.name,
        snapshot_run_ids: snapshotRunIds,
        initial_states: initialStates,
        actions,
      });

      toast.success("Execution completed", {
        description: "Process execution finished successfully",
      });
    } catch (err) {
      toast.error("Execution failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleStop = () => {
    reset();
    toast.info("Execution stopped");
  };

  return (
    <RequireProject pageName="Integration Testing">
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Integration Testing</h1>
          <p className="text-gray-600 mt-1">
            Execute and visualize automation processes using recorded snapshots
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="execute">Execute</TabsTrigger>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
            <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>

          {/* Execute Tab */}
          <TabsContent value="execute" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Controls Panel */}
              <div className="space-y-4">
                <SmartSnapshotSelector
                  selectedSnapshots={selectedSnapshots}
                  onChange={setSelectedSnapshots}
                  processId={selectedProcessId}
                />

                <ExecutionControls
                  selectedSnapshots={selectedSnapshots}
                  onExecute={handleExecute}
                  onStop={handleStop}
                  isExecuting={loading}
                  onProcessChange={setSelectedProcessId}
                />
              </div>

              {/* Visualization Panel */}
              <div className="lg:col-span-2">
                {error && (
                  <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-800 font-medium">Error</p>
                    <p className="text-red-700 text-sm mt-1">{error.message}</p>
                  </div>
                )}

                {result ? (
                  <ExecutionVisualization result={result} />
                ) : loading ? (
                  <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <div className="text-center text-gray-500">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
                      <p className="text-lg font-medium">
                        Executing process...
                      </p>
                      <p className="text-sm mt-1">
                        Please wait while the process runs
                      </p>
                    </div>
                  </div>
                ) : selectedSnapshots.length > 0 ? (
                  <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <div className="text-center text-gray-500">
                      <p className="text-lg font-medium">Ready to execute</p>
                      <p className="text-sm mt-1">
                        Select a process and configure initial states, then
                        click Execute
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <div className="text-center text-gray-500">
                      <p className="text-lg font-medium">
                        No snapshots selected
                      </p>
                      <p className="text-sm mt-1">
                        Select one or more snapshots to begin
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Coverage Tab */}
          <TabsContent value="coverage">
            <StateCoveragePanel
              processId={selectedProcessId}
              processName={
                workflows.find((w) => w.id === selectedProcessId)?.name
              }
              snapshotRunIds={selectedSnapshots.map((s) => s.run_id)}
              autoRefresh={false}
            />
          </TabsContent>

          {/* Snapshots Tab */}
          <TabsContent value="snapshots">
            <SnapshotListCard
              onSelect={(snapshot) => {
                // Add snapshot to selection (or toggle if already selected)
                const isSelected = selectedSnapshots.some(
                  (s) => s.id === snapshot.id
                );
                if (isSelected) {
                  setSelectedSnapshots(
                    selectedSnapshots.filter((s) => s.id !== snapshot.id)
                  );
                } else {
                  setSelectedSnapshots([...selectedSnapshots, snapshot]);
                }
                setActiveTab("execute");
              }}
              selectedSnapshotId={selectedSnapshots[0]?.id}
            />
          </TabsContent>

          {/* Import Tab */}
          <TabsContent value="import">
            <div className="max-w-2xl">
              <SnapshotImportCard
                onImportSuccess={() => {
                  setActiveTab("snapshots");
                }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </RequireProject>
  );
}
