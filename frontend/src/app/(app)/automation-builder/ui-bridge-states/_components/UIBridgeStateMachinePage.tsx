"use client";

import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Network,
  Search,
  GitBranch,
  Route,
  Download,
  Plus,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useUIBridgeStateMachine } from "../_hooks/useUIBridgeStateMachine";
import { useUIBridgeTransitions } from "../_hooks/useUIBridgeTransitions";
import { usePathfinding } from "../_hooks/usePathfinding";
import { useExportStateMachine } from "../_hooks/useExportStateMachine";
import { UIBridgeStateGraph } from "./UIBridgeStateGraph";
import { UIBridgeStatePanel } from "./UIBridgeStatePanel";
import { UIBridgeTransitionEditor } from "./UIBridgeTransitionEditor";
import { PathfindingPanel } from "./PathfindingPanel";
import { ExportPanel } from "./ExportPanel";
import type { UIBridgeTransitionCreate } from "../_types";

export function UIBridgeStateMachinePage() {
  const sm = useUIBridgeStateMachine();
  const transitions = useUIBridgeTransitions(sm.selectedConfigId);
  const pathfinding = usePathfinding(sm.selectedConfigId);
  const exporter = useExportStateMachine(sm.selectedConfigId);

  const [activeTab, setActiveTab] = useState("graph");
  const [showNewTransition, setShowNewTransition] = useState(false);

  // Determine what side panel to show
  const showStatePanel = sm.selectedState && !showNewTransition;
  const showTransitionPanel = (sm.selectedTransition || showNewTransition) && !sm.selectedState;

  // Handle transition operations
  const handleCreateTransition = useCallback(
    async (data: UIBridgeTransitionCreate) => {
      const result = await transitions.createTransition(data);
      if (result) {
        setShowNewTransition(false);
        sm.refresh();
      }
    },
    [transitions, sm]
  );

  const handleUpdateTransition = useCallback(
    async (id: string, data: Partial<UIBridgeTransitionCreate>) => {
      const result = await transitions.updateTransition(id, data);
      if (result) {
        sm.refresh();
      }
    },
    [transitions, sm]
  );

  const handleDeleteTransition = useCallback(
    async (id: string) => {
      const result = await transitions.deleteTransition(id);
      if (result) {
        sm.setSelectedTransitionId(null);
        sm.refresh();
      }
    },
    [transitions, sm]
  );

  // No project selected
  if (!sm.projectId) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-text-muted">
        Select a project to manage state machines.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary bg-surface-primary">
        <div className="flex items-center gap-3">
          <Network className="size-5 text-brand-primary" />
          <h1 className="text-lg font-semibold text-text-primary">
            State Machine
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Config selector */}
          <Select
            value={sm.selectedConfigId ?? ""}
            onValueChange={(v) => sm.setSelectedConfigId(v || null)}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select configuration..." />
            </SelectTrigger>
            <SelectContent>
              {sm.configs.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.render_count} renders)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              sm.loadConfigs();
              sm.refresh();
            }}
            disabled={sm.isLoading}
          >
            <RefreshCw className={`size-3.5 ${sm.isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="border-b border-border-primary bg-surface-primary px-6">
          <TabsList className="bg-transparent">
            <TabsTrigger value="discovery" className="gap-1.5">
              <Search className="size-3.5" />
              Discovery
            </TabsTrigger>
            <TabsTrigger value="graph" className="gap-1.5">
              <GitBranch className="size-3.5" />
              Graph Editor
            </TabsTrigger>
            <TabsTrigger value="pathfinding" className="gap-1.5">
              <Route className="size-3.5" />
              Pathfinding
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1.5">
              <Download className="size-3.5" />
              Export
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Discovery Tab - redirect to extraction page */}
        <TabsContent value="discovery" className="flex-1 p-6">
          <div className="text-center py-12 space-y-4">
            <Search className="size-12 text-text-muted mx-auto" />
            <h2 className="text-lg font-medium text-text-primary">
              Discover States
            </h2>
            <p className="text-sm text-text-muted max-w-md mx-auto">
              Use the Discover page to run UI Bridge exploration and discover
              application states from render logs.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = `/automation-builder/extraction?method=ui-bridge&project=${sm.projectId}`;
              }}
            >
              <Search className="size-4 mr-1.5" />
              Go to Discover
            </Button>
            {sm.configs.length > 0 && (
              <p className="text-xs text-text-muted">
                You have {sm.configs.length} saved configuration{sm.configs.length !== 1 ? "s" : ""}.
                Select one above to view in the Graph Editor.
              </p>
            )}
          </div>
        </TabsContent>

        {/* Graph Editor Tab */}
        <TabsContent value="graph" className="flex-1 flex min-h-0">
          {sm.isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-brand-primary" />
            </div>
          ) : !sm.selectedConfigId ? (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              Select a configuration to view the state graph.
            </div>
          ) : (
            <>
              {/* Graph */}
              <div className="flex-1 relative">
                {/* Add Transition FAB */}
                <div className="absolute top-4 left-4 z-10">
                  <Button
                    size="sm"
                    onClick={() => {
                      sm.setSelectedStateId(null);
                      sm.setSelectedTransitionId(null);
                      setShowNewTransition(true);
                    }}
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    Add Transition
                  </Button>
                </div>

                <UIBridgeStateGraph
                  states={sm.fullConfig?.states ?? []}
                  transitions={sm.fullConfig?.transitions ?? []}
                  selectedStateId={sm.selectedStateId}
                  selectedTransitionId={sm.selectedTransitionId}
                  onSelectState={(id) => {
                    sm.setSelectedStateId(id);
                    sm.setSelectedTransitionId(null);
                    setShowNewTransition(false);
                  }}
                  onSelectTransition={(id) => {
                    sm.setSelectedTransitionId(id);
                    sm.setSelectedStateId(null);
                    setShowNewTransition(false);
                  }}
                  highlightedPath={pathfinding.result?.steps}
                />
              </div>

              {/* Side Panel */}
              {showStatePanel && sm.selectedState && (
                <UIBridgeStatePanel
                  state={sm.selectedState}
                  configId={sm.selectedConfigId!}
                  onClose={() => sm.setSelectedStateId(null)}
                  onUpdate={() => sm.refresh()}
                />
              )}

              {showTransitionPanel && (
                <UIBridgeTransitionEditor
                  transition={sm.selectedTransition}
                  states={sm.fullConfig?.states ?? []}
                  onSave={handleCreateTransition}
                  onUpdate={handleUpdateTransition}
                  onDelete={handleDeleteTransition}
                  onClose={() => {
                    sm.setSelectedTransitionId(null);
                    setShowNewTransition(false);
                  }}
                />
              )}
            </>
          )}
        </TabsContent>

        {/* Pathfinding Tab */}
        <TabsContent value="pathfinding" className="flex-1 overflow-y-auto">
          {!sm.selectedConfigId ? (
            <div className="flex items-center justify-center h-full text-text-muted">
              Select a configuration to use pathfinding.
            </div>
          ) : (
            <PathfindingPanel
              states={sm.fullConfig?.states ?? []}
              result={pathfinding.result}
              isLoading={pathfinding.isLoading}
              onFindPath={pathfinding.findPath}
              onClear={pathfinding.clearResult}
            />
          )}
        </TabsContent>

        {/* Export Tab */}
        <TabsContent value="export" className="flex-1 overflow-y-auto">
          {!sm.selectedConfigId ? (
            <div className="flex items-center justify-center h-full text-text-muted">
              Select a configuration to export.
            </div>
          ) : (
            <ExportPanel
              isExporting={exporter.isExporting}
              onDownload={exporter.downloadExport}
              configName={sm.fullConfig?.name ?? null}
              stateCount={sm.fullConfig?.states.length ?? 0}
              transitionCount={sm.fullConfig?.transitions.length ?? 0}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
