"use client";

import { useReducer, useEffect, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Network, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRunnerHealth } from "@/lib/runner-api";
import { validateStateMachine } from "@/lib/state-machine-builder/validation";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import {
  builderReducer,
  getInitialBuilderState,
} from "@/lib/state-machine-builder/reducer";
import type { BuilderMode } from "@/lib/state-machine-builder/types";
import { StateMachineCanvas } from "@/components/state-machine-builder/graph/StateMachineCanvas";
import { DiscoveryPanel } from "@/components/state-machine-builder/discovery/DiscoveryPanel";
import { StateListPanel } from "@/components/state-machine-builder/editor/StateListPanel";
import { TransitionListPanel } from "@/components/state-machine-builder/editor/TransitionListPanel";
import { StatePropertiesEditor } from "@/components/state-machine-builder/editor/StatePropertiesEditor";
import { TransitionPropertiesEditor } from "@/components/state-machine-builder/editor/TransitionPropertiesEditor";
import { AddStateDialog } from "@/components/state-machine-builder/editor/AddStateDialog";
import { AddTransitionDialog } from "@/components/state-machine-builder/editor/AddTransitionDialog";
import { StatisticsPanel } from "@/components/state-machine-builder/view/StatisticsPanel";
import { ExportPanel } from "@/components/state-machine-builder/view/ExportPanel";
import { SaveLoadToolbar } from "@/components/state-machine-builder/SaveLoadToolbar";
import { useProjects } from "@/hooks/use-projects";
import { useStateMachineConfig } from "@/hooks/use-state-machine-configs";

export default function StateMachineBuilderPage() {
  const { isOffline } = useRunnerHealth();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(
    builderReducer,
    undefined,
    getInitialBuilderState
  );
  const [addStateOpen, setAddStateOpen] = useState(false);
  const [addTransitionOpen, setAddTransitionOpen] = useState(false);

  // Project selection
  const { data: projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Load config from URL if ?id= is present
  const configIdFromUrl = searchParams?.get("id") ?? null;
  const configQuery = useStateMachineConfig(selectedProjectId, configIdFromUrl);

  // Auto-select first project if none selected
  useEffect(() => {
    const firstProject = projects?.[0];
    if (!selectedProjectId && firstProject) {
      setSelectedProjectId(firstProject.id);
    }
  }, [projects, selectedProjectId]);

  // Load config from URL on mount
  useEffect(() => {
    if (configQuery.data && configIdFromUrl) {
      const cfg = configQuery.data;
      dispatch({
        type: "LOAD_CONFIG",
        config: {
          name: cfg.name,
          version: cfg.version,
          exportedAt: cfg.updated_at,
          source: "state-discovery",
          metadata: {},
          states: cfg.configuration.states as never[],
          transitions: cfg.configuration.transitions as never[],
          fingerprintDetails: cfg.configuration.fingerprintDetails as never,
        },
      });
      dispatch({ type: "SET_CONFIG_ID", configId: cfg.id });
      dispatch({ type: "MARK_SAVED" });
    }
  }, [configQuery.data, configIdFromUrl]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state.isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.isDirty]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSelectState = useCallback(
    (id: string | null) => dispatch({ type: "SELECT_STATE", id }),
    []
  );

  const handleSelectTransition = useCallback(
    (id: string | null) => dispatch({ type: "SELECT_TRANSITION", id }),
    []
  );

  const handleDeselectAll = useCallback(() => {
    dispatch({ type: "SELECT_STATE", id: null });
    dispatch({ type: "SELECT_TRANSITION", id: null });
  }, []);

  const handleDeleteState = useCallback(
    (id: string) => dispatch({ type: "DELETE_STATE", id }),
    []
  );

  const handleDeleteTransition = useCallback(
    (id: string) => dispatch({ type: "DELETE_TRANSITION", id }),
    []
  );

  const validationResult = useMemo(
    () => validateStateMachine(state.states, state.transitions),
    [state.states, state.transitions]
  );

  const selectedState = state.selectedStateId
    ? state.states.find((s) => s.id === state.selectedStateId) ?? null
    : null;

  const selectedTransition = state.selectedTransitionId
    ? state.transitions.find((t) => t.id === state.selectedTransitionId) ??
      null
    : null;

  if (isOffline) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas">
        <RunnerOfflineState />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        {/* Header */}
        <header className="h-14 border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <Network className="size-5 text-[var(--brand-secondary)]" />
            <h1 className="text-lg font-bold text-text-primary">
              State Machine Builder
            </h1>
            {state.isDirty && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]"
              >
                Unsaved
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Project Selector */}
            {projects && projects.length > 0 && (
              <Select
                value={selectedProjectId ?? ""}
                onValueChange={setSelectedProjectId}
              >
                <SelectTrigger className="h-8 w-40 text-xs bg-surface-raised/50 border-border-subtle">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Save/Load */}
            <SaveLoadToolbar
              state={state}
              dispatch={dispatch}
              projectId={selectedProjectId}
            />

            {/* Mode Tabs */}
            <Tabs
              value={state.mode}
              onValueChange={(v) =>
                dispatch({ type: "SET_MODE", mode: v as BuilderMode })
              }
            >
              <TabsList className="bg-surface-raised/50 border border-border-subtle">
                <TabsTrigger
                  value="discover"
                  className="text-xs data-[state=active]:bg-[var(--brand-secondary)]/20 data-[state=active]:text-[var(--brand-secondary)]"
                >
                  Discover
                </TabsTrigger>
                <TabsTrigger
                  value="edit"
                  className="text-xs data-[state=active]:bg-[var(--brand-secondary)]/20 data-[state=active]:text-[var(--brand-secondary)]"
                >
                  Edit
                </TabsTrigger>
                <TabsTrigger
                  value="view"
                  className="text-xs data-[state=active]:bg-[var(--brand-secondary)]/20 data-[state=active]:text-[var(--brand-secondary)]"
                >
                  View
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Undo/Redo */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dispatch({ type: "UNDO" })}
                    disabled={state.undoStack.length === 0}
                    className="h-8 w-8 p-0"
                  >
                    <Undo2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dispatch({ type: "REDO" })}
                    disabled={state.redoStack.length === 0}
                    className="h-8 w-8 p-0"
                  >
                    <Redo2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 min-h-0">
          {/* Left Panel */}
          <div className="w-80 border-r border-border-subtle bg-surface-raised/50 overflow-y-auto scrollbar-dark shrink-0">
            <div className="p-4">
              {state.mode === "discover" && (
                <DiscoveryPanel state={state} dispatch={dispatch} />
              )}
              {state.mode === "edit" && (
                <div className="space-y-4">
                  <StateListPanel
                    states={state.states}
                    selectedStateId={state.selectedStateId}
                    onSelect={(id) => handleSelectState(id)}
                    onAdd={() => setAddStateOpen(true)}
                    onDelete={handleDeleteState}
                  />
                  <TransitionListPanel
                    transitions={state.transitions}
                    states={state.states}
                    selectedTransitionId={state.selectedTransitionId}
                    onSelect={(id) => handleSelectTransition(id)}
                    onAdd={() => setAddTransitionOpen(true)}
                    onDelete={handleDeleteTransition}
                  />
                </div>
              )}
              {state.mode === "view" && (
                <div className="space-y-6">
                  <StatisticsPanel
                    states={state.states}
                    transitions={state.transitions}
                    validationResult={validationResult}
                    onSelectState={handleSelectState}
                  />
                  <ExportPanel
                    states={state.states}
                    transitions={state.transitions}
                    fingerprintDetails={state.fingerprintDetails}
                    configName={state.configName}
                    isDirty={state.isDirty}
                    dispatch={dispatch}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Center Canvas */}
          <div className="flex-1 min-h-0 min-w-0">
            <StateMachineCanvas
              states={state.states}
              transitions={state.transitions}
              selectedStateId={state.selectedStateId}
              selectedTransitionId={state.selectedTransitionId}
              mode={state.mode}
              onSelectState={handleSelectState}
              onSelectTransition={handleSelectTransition}
              onDeselectAll={handleDeselectAll}
              dispatch={dispatch}
              validationIssues={validationResult.issues}
            />
          </div>

          {/* Right Panel (shown on selection) */}
          {(selectedState || selectedTransition) && (
            <div className="w-96 border-l border-border-subtle bg-surface-raised/95 backdrop-blur-sm overflow-y-auto scrollbar-dark shrink-0 animate-in slide-in-from-right duration-200">
              <div className="p-4">
                {selectedState && (
                  <StatePropertiesEditor
                    state={selectedState}
                    dispatch={dispatch}
                  />
                )}
                {selectedTransition && (
                  <TransitionPropertiesEditor
                    transition={selectedTransition}
                    states={state.states}
                    dispatch={dispatch}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Status Bar */}
        <footer className="h-8 border-t border-border-subtle/50 bg-surface-canvas/80 flex items-center px-4 text-xs text-text-muted shrink-0">
          <span data-content-role="metric" data-content-label="state count">States: {state.states.length}</span>
          <span className="mx-3 text-border-subtle">|</span>
          <span data-content-role="metric" data-content-label="transition count">Transitions: {state.transitions.length}</span>
          {state.isDirty && (
            <>
              <span className="mx-3 text-border-subtle">|</span>
              <span data-content-role="status" data-content-label="save status" className="text-amber-400">Unsaved changes</span>
            </>
          )}
          {state.undoStack.length > 0 && (
            <>
              <span className="mx-3 text-border-subtle">|</span>
              <span data-content-role="metric" data-content-label="undo redo count">
                Undo: {state.undoStack.length} | Redo:{" "}
                {state.redoStack.length}
              </span>
            </>
          )}
        </footer>

        {/* Dialogs */}
        <AddStateDialog
          open={addStateOpen}
          onOpenChange={setAddStateOpen}
          onAdd={(s) => dispatch({ type: "ADD_STATE", state: s })}
          existingIds={state.states.map((s) => s.id)}
        />
        <AddTransitionDialog
          open={addTransitionOpen}
          onOpenChange={setAddTransitionOpen}
          onAdd={(t) => dispatch({ type: "ADD_TRANSITION", transition: t })}
          states={state.states}
        />
      </div>
    </TooltipProvider>
  );
}
