"use client";

import { useState, useCallback, useEffect } from "react";
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
  GitBranch,
  Route,
  Download,
  Plus,
  RefreshCw,
  Loader2,
  Search,
  Layers,
  ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useUIBridgeStateMachine } from "../_hooks/useUIBridgeStateMachine";
import { useUIBridgeTransitions } from "../_hooks/useUIBridgeTransitions";
import { usePathfinding } from "../_hooks/usePathfinding";
import { useExportStateMachine } from "../_hooks/useExportStateMachine";
import { useElementDrag } from "../_hooks/useElementDrag";
import { UIBridgeStateGraph } from "./UIBridgeStateGraph";
import { UIBridgeStatePanel } from "./UIBridgeStatePanel";
import { UIBridgeTransitionEditor } from "./UIBridgeTransitionEditor";
import { PathfindingPanel } from "./PathfindingPanel";
import { ExportPanel } from "./ExportPanel";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { StateViewPanel } from "./StateViewPanel";
import { TransitionsPanel } from "./TransitionsPanel";
import type { UIBridgeTransitionCreate } from "../_types";
import { useAutomationStore } from "@/stores/automation";

export function UIBridgeStateMachinePage() {
  const sm = useUIBridgeStateMachine();
  const transitions = useUIBridgeTransitions(sm.selectedConfigId);
  const pathfinding = usePathfinding(sm.selectedConfigId);
  const exporter = useExportStateMachine(sm.selectedConfigId);
  const projectId = useAutomationStore((s) => s.projectId);

  const [activeTab, setActiveTab] = useState("discovery");
  const [showNewTransition, setShowNewTransition] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

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

  // Handle element update for drag-and-drop reassignment
  const handleUpdateState = useCallback(
    async (stateId: string, elementIds: string[]) => {
      if (!projectId || !sm.selectedConfigId) return;
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${sm.selectedConfigId}/states/${stateId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ element_ids: elementIds }),
          }
        );
        if (!res.ok) {
          toast.error("Failed to update state elements");
        }
      } catch {
        toast.error("Failed to update state elements");
      }
      sm.refresh();
    },
    [projectId, sm]
  );

  // Drag-and-drop hook for element-based transition creation
  const elementDrag = useElementDrag({
    states: sm.fullConfig?.states ?? [],
    transitions: sm.fullConfig?.transitions ?? [],
    onCreateTransition: handleCreateTransition,
    onUpdateState: handleUpdateState,
  });

  // When a new config is created via discovery, select it and switch to graph
  const handleConfigCreated = useCallback(
    async (configId: string) => {
      await sm.loadConfigs();
      sm.setSelectedConfigId(configId);
      setActiveTab("graph");
    },
    [sm]
  );

  // Show consistent empty state for SSR and when no project is selected
  if (!hasMounted || !sm.projectId) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-text-muted">
        {hasMounted ? "Select a project to manage state machines." : ""}
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
            <TabsTrigger value="states" className="gap-1.5">
              <Layers className="size-3.5" />
              State View
            </TabsTrigger>
            <TabsTrigger value="transitions" className="gap-1.5">
              <ArrowRightLeft className="size-3.5" />
              Transitions
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

        {/* Discovery Tab */}
        <TabsContent value="discovery" className="flex-1 overflow-y-auto">
          <DiscoveryPanel
            projectId={sm.projectId}
            onConfigCreated={handleConfigCreated}
          />
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
                  onStartElementDrag={elementDrag.handleStartElementDrag}
                  onDragOver={elementDrag.handleDragOver}
                  onDrop={elementDrag.handleDrop}
                  isDragging={elementDrag.isDragging}
                  dropTargetStateId={elementDrag.dropTargetStateId}
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

        {/* State View Tab */}
        <TabsContent value="states" className="flex-1 flex min-h-0">
          {!sm.selectedConfigId ? (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              Select a configuration to view states.
            </div>
          ) : (
            <StateViewPanel
              states={sm.fullConfig?.states ?? []}
              transitions={sm.fullConfig?.transitions ?? []}
              selectedStateId={sm.selectedStateId}
              onSelectState={(id) => {
                sm.setSelectedStateId(id);
                sm.setSelectedTransitionId(null);
              }}
            />
          )}
        </TabsContent>

        {/* Transitions Tab */}
        <TabsContent value="transitions" className="flex-1 flex min-h-0">
          {!sm.selectedConfigId ? (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              Select a configuration to view transitions.
            </div>
          ) : (
            <TransitionsPanel
              states={sm.fullConfig?.states ?? []}
              transitions={sm.fullConfig?.transitions ?? []}
              onSelectTransition={(id) => {
                sm.setSelectedTransitionId(id);
                sm.setSelectedStateId(null);
              }}
            />
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
              isPushing={exporter.isPushing}
              onDownload={exporter.downloadExport}
              onPushToRunner={exporter.pushToRunner}
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
