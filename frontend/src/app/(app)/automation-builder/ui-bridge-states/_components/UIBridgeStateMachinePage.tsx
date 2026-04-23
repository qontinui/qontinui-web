"use client";

import { useState, useCallback } from "react";
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
import { useExportStateMachine } from "../_hooks/useExportStateMachine";
import { useElementDrag } from "../_hooks/useElementDrag";
import { UIBridgeStateGraph } from "./UIBridgeStateGraph";
import { ExportPanel } from "./ExportPanel";
import { DiscoveryPanel } from "./DiscoveryPanel";
import {
  StateViewPanel,
  TransitionsPanel,
  TransitionEditor,
  StateDetailPanel,
  PathfindingPanel,
} from "@qontinui/workflow-ui/state-machine";
import type { StateMachineTransitionCreate } from "../_types";
import type {
  StateMachineStateUpdate,
  PathfindingResult,
} from "@qontinui/shared-types";
import { useAutomationStore } from "@/stores/automation";
import { useStateMachineDiscovery } from "../_hooks/useStateMachineDiscovery";

const TABS = [
  { value: "discovery", label: "Discovery", icon: Search },
  { value: "graph", label: "Graph Editor", icon: GitBranch },
  { value: "states", label: "State View", icon: Layers },
  { value: "transitions", label: "Transitions", icon: ArrowRightLeft },
  { value: "pathfinding", label: "Pathfinding", icon: Route },
  { value: "export", label: "Export", icon: Download },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export function UIBridgeStateMachinePage() {
  const sm = useUIBridgeStateMachine();
  const transitions = useUIBridgeTransitions(sm.selectedConfigId);
  const exporter = useExportStateMachine(sm.selectedConfigId);
  const projectId = useAutomationStore((s) => s.projectId);
  const discovery = useStateMachineDiscovery(sm.projectId);

  const [activeTab, setActiveTab] = useState<TabValue>("discovery");
  const [showNewTransition, setShowNewTransition] = useState(false);
  const [highlightedPath, setHighlightedPath] = useState<
    PathfindingResult["steps"] | undefined
  >();

  // Determine what side panel to show
  const showStatePanel = sm.selectedState && !showNewTransition;
  const showTransitionPanel =
    (sm.selectedTransition || showNewTransition) && !sm.selectedState;

  const noProject = !sm.projectId;
  const noConfig = !noProject && !sm.selectedConfigId;
  const hasConfig = !noProject && !!sm.selectedConfigId;

  // Handle transition operations
  const handleCreateTransition = useCallback(
    async (data: StateMachineTransitionCreate) => {
      const result = await transitions.createTransition(data);
      if (result) {
        setShowNewTransition(false);
        sm.refresh();
      }
    },
    [transitions, sm]
  );

  const handleUpdateTransition = useCallback(
    async (id: string, data: Partial<StateMachineTransitionCreate>) => {
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

  // Save state updates (used by StateDetailPanel and drag-and-drop)
  const handleSaveState = useCallback(
    async (stateId: string, updates: StateMachineStateUpdate) => {
      if (!projectId || !sm.selectedConfigId) return;
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${sm.selectedConfigId}/states/${stateId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(updates),
          }
        );
        if (!res.ok) {
          toast.error("Failed to update state");
        }
      } catch {
        toast.error("Failed to update state");
      }
      sm.refresh();
    },
    [projectId, sm]
  );

  // Handle element update for drag-and-drop reassignment
  const handleUpdateState = useCallback(
    async (stateId: string, elementIds: string[]) => {
      await handleSaveState(stateId, { element_ids: elementIds });
    },
    [handleSaveState]
  );

  // Handle pathfinding result for graph highlighting
  const handlePathFound = useCallback((result: PathfindingResult) => {
    setHighlightedPath(result.found ? result.steps : undefined);
  }, []);

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

  return (
    <div className="flex flex-col h-full">
      {/* Header — always visible */}
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
            onValueChange={(v) => {
              sm.setSelectedConfigId(v || null);
              if (v) discovery.reset();
            }}
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
            <RefreshCw
              className={`size-3.5 mr-1.5 ${sm.isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tab Navigation — regular buttons for correct role="button" */}
      <div className="border-b border-border-primary bg-surface-primary px-6">
        <div className="inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] ${
                activeTab === value
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content — all panels stay in DOM (hidden when inactive) */}

      {/* Discovery Tab */}
      <div
        className={`flex-1 overflow-y-auto ${activeTab !== "discovery" ? "hidden" : ""}`}
      >
        <div
          className={
            noProject
              ? "flex items-center justify-center h-full min-h-[200px] text-text-muted"
              : "hidden"
          }
        >
          Select a project to manage state machines
        </div>
        <div className={noProject ? "hidden" : ""}>
          <DiscoveryPanel
            discovery={discovery}
            onConfigCreated={handleConfigCreated}
          />
        </div>
      </div>

      {/* Graph Editor Tab */}
      <div
        className={`flex-1 flex min-h-0 ${activeTab !== "graph" ? "hidden" : ""}`}
      >
        <div
          className={
            noProject
              ? "flex-1 flex items-center justify-center text-text-muted"
              : "hidden"
          }
        >
          Select a project to manage state machines
        </div>
        <div
          className={
            sm.isLoading && !noProject
              ? "flex-1 flex items-center justify-center"
              : "hidden"
          }
        >
          <Loader2 className="size-8 animate-spin text-brand-primary" />
        </div>
        <div
          className={
            noConfig && !sm.isLoading
              ? "flex-1 flex items-center justify-center text-text-muted"
              : "hidden"
          }
        >
          Select a configuration to view the state graph
        </div>
        <div className={hasConfig && !sm.isLoading ? "flex-1 flex" : "hidden"}>
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
              // Hidden-tab gate: ReactFlow's onSelectionChange fires when its
              // tab becomes hidden, which would clobber selections made in
              // other tabs. Only accept graph-origin selection changes while
              // the graph is actually the active tab.
              onSelectState={(id) => {
                if (activeTab !== "graph") return;
                sm.setSelectedStateId(id);
                sm.setSelectedTransitionId(null);
                setShowNewTransition(false);
              }}
              onSelectTransition={(id) => {
                if (activeTab !== "graph") return;
                sm.setSelectedTransitionId(id);
                sm.setSelectedStateId(null);
                setShowNewTransition(false);
              }}
              highlightedPath={highlightedPath}
              onStartElementDrag={elementDrag.handleStartElementDrag}
              onDragOver={elementDrag.handleDragOver}
              onDrop={elementDrag.handleDrop}
              isDragging={elementDrag.isDragging}
              dropTargetStateId={elementDrag.dropTargetStateId}
              onDeleteTransition={handleDeleteTransition}
            />
          </div>

          {/* Side Panel — State */}
          <div
            className={
              showStatePanel && sm.selectedState
                ? "w-80 border-l border-border-primary bg-surface-primary overflow-y-auto"
                : "hidden"
            }
          >
            {sm.selectedState && (
              <StateDetailPanel
                state={sm.selectedState}
                onSave={handleSaveState}
                onClose={() => sm.setSelectedStateId(null)}
              />
            )}
          </div>

          {/* Side Panel — Transition Editor */}
          <div
            className={
              showTransitionPanel
                ? "w-80 border-l border-border-primary bg-surface-primary overflow-y-auto"
                : "hidden"
            }
          >
            <TransitionEditor
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
          </div>
        </div>
      </div>

      {/* State View Tab */}
      <div
        className={`flex-1 flex min-h-0 ${activeTab !== "states" ? "hidden" : ""}`}
      >
        <div
          className={
            noProject
              ? "flex-1 flex items-center justify-center text-text-muted"
              : "hidden"
          }
        >
          Select a project to manage state machines
        </div>
        <div
          className={
            noConfig && !sm.isLoading
              ? "flex-1 flex items-center justify-center text-text-muted"
              : "hidden"
          }
        >
          Select a configuration to view states
        </div>
        <div className={hasConfig ? "flex-1 flex" : "hidden"}>
          <StateViewPanel
            states={sm.fullConfig?.states ?? []}
            transitions={sm.fullConfig?.transitions ?? []}
            selectedStateId={sm.selectedStateId}
            onSelectState={(id) => {
              sm.setSelectedStateId(id);
              sm.setSelectedTransitionId(null);
            }}
          />
        </div>
      </div>

      {/* Transitions Tab */}
      <div
        className={`flex-1 flex min-h-0 ${activeTab !== "transitions" ? "hidden" : ""}`}
      >
        <div
          className={
            noProject
              ? "flex-1 flex items-center justify-center text-text-muted"
              : "hidden"
          }
        >
          Select a project to manage state machines
        </div>
        <div
          className={
            noConfig && !sm.isLoading
              ? "flex-1 flex items-center justify-center text-text-muted"
              : "hidden"
          }
        >
          Select a configuration to view transitions
        </div>
        <div className={hasConfig ? "flex-1 flex" : "hidden"}>
          <TransitionsPanel
            states={sm.fullConfig?.states ?? []}
            transitions={sm.fullConfig?.transitions ?? []}
            onSelectTransition={(id) => {
              sm.setSelectedTransitionId(id);
              sm.setSelectedStateId(null);
            }}
          />
        </div>
      </div>

      {/* Pathfinding Tab */}
      <div
        className={`flex-1 overflow-y-auto ${activeTab !== "pathfinding" ? "hidden" : ""}`}
      >
        <div
          className={
            noProject
              ? "flex items-center justify-center h-full text-text-muted"
              : "hidden"
          }
        >
          Select a project to manage state machines
        </div>
        <div
          className={
            noConfig && !sm.isLoading
              ? "flex items-center justify-center h-full text-text-muted"
              : "hidden"
          }
        >
          Select a configuration to use pathfinding
        </div>
        <div className={hasConfig ? "" : "hidden"}>
          <PathfindingPanel
            states={sm.fullConfig?.states ?? []}
            transitions={sm.fullConfig?.transitions ?? []}
            onPathFound={handlePathFound}
          />
        </div>
      </div>

      {/* Export Tab */}
      <div
        className={`flex-1 overflow-y-auto ${activeTab !== "export" ? "hidden" : ""}`}
      >
        <div
          className={
            noProject
              ? "flex items-center justify-center h-full text-text-muted"
              : "hidden"
          }
        >
          Select a project to manage state machines
        </div>
        <div
          className={
            noConfig && !sm.isLoading
              ? "flex items-center justify-center h-full text-text-muted"
              : "hidden"
          }
        >
          Select a configuration to export
        </div>
        <div className={hasConfig ? "" : "hidden"}>
          <ExportPanel
            isExporting={exporter.isExporting}
            isPushing={exporter.isPushing}
            onDownload={exporter.downloadExport}
            onPushToRunner={exporter.pushToRunner}
            configName={sm.fullConfig?.name ?? null}
            stateCount={sm.fullConfig?.states.length ?? 0}
            transitionCount={sm.fullConfig?.transitions.length ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
