"use client";

import React from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  OutgoingTransition,
  IncomingTransition,
} from "@/hooks/automation";
import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder";
import { StatePropertiesPanel } from "@/components/state-properties";
import { TransitionPropertiesPanel } from "@/components/transition-properties-panel";
import { BatchMonitorSettingsDialog } from "@/components/batch-monitor-settings-dialog";
import { TransitionPositionManager } from "./TransitionPositionManager";
import { useStateElementCrud } from "./hooks/use-state-element-crud";
import { useImageDrag } from "./hooks/use-image-drag";
import { useStateMachineState } from "./_hooks/useStateMachineState";
import { useStateMachineHandlers } from "./_hooks/useStateMachineHandlers";
import { useStateUpdateCoordinator } from "./_hooks/useStateUpdateCoordinator";
import { useBuildNodesEdges } from "./_hooks/useBuildNodesEdges";
import { StateMachineSidebar } from "./_components/StateMachineSidebar";
import { nodeTypes, edgeTypes } from "./state-machine-utils";

export function StateStructure() {
  const {
    states,
    transitions,
    workflows,
    images,
    pageState,
    selectedNode,
    setSelectedNode,
    selectedEdge,
    setSelectedEdge,
    batchMonitorDialogOpen,
    setBatchMonitorDialogOpen,
    outgoingTransitionDialogOpen,
    setOutgoingTransitionDialogOpen,
    preselectedOriginState,
    setPreselectedOriginState,
    pendingIdChangeRef,
    prevCountsRef,
    isDraggingRef,
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
    selectedState,
    selectedTransition,
    addWorkflow,
    updateWorkflow,
    addState,
    updateState,
    updateStateWithIdChange,
    deleteState,
    addTransition,
    updateTransition,
    deleteTransition,
  } = useStateMachineState();

  const { updateSelectedState, updateSelectedTransition } =
    useStateUpdateCoordinator({
      states,
      transitions,
      workflows,
      selectedNode,
      selectedEdge,
      pendingIdChangeRef,
      setSelectedNode,
      updateState,
      updateStateWithIdChange,
      updateTransition,
      updateWorkflow,
    });

  const {
    addStateImage,
    updateStateImage,
    removeStateImage,
    moveStateImage,
    addRegion,
    updateRegion,
    removeRegion,
    addLocation,
    updateLocation,
    removeLocation,
    addString,
    updateString,
    removeString,
  } = useStateElementCrud({
    selectedNode,
    states,
    updateSelectedState,
    updateState,
  });

  const { handleStartImageDrag, handleDragOver, handleDrop } = useImageDrag({
    states,
    transitions,
    workflows,
    addWorkflow,
    updateWorkflow,
    addTransition,
    updateTransition,
    updateState,
  });

  const {
    handleNodesChange,
    handleAddOutgoingTransition,
    handleAddState,
    handleDeleteState,
    handleApplyMonitors,
    applyAutoLayout,
    onConnect,
  } = useStateMachineHandlers({
    states,
    transitions,
    nodes,
    edges,
    selectedNode,
    isDraggingRef,
    prevCountsRef,
    onNodesChange,
    setSelectedNode,
    setPreselectedOriginState,
    setOutgoingTransitionDialogOpen,
    addState,
    updateState,
    deleteState,
    addTransition,
    updateTransition,
  });

  useBuildNodesEdges({
    states,
    transitions,
    images,
    isDraggingRef,
    setNodes,
    setEdges,
    handleAddOutgoingTransition,
    handleStartImageDrag,
  });

  if (pageState.isHydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-muted">Loading page state...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <StateMachineSidebar
        states={states}
        selectedNode={selectedNode}
        onAddState={handleAddState}
        onAutoLayout={applyAutoLayout}
        onOpenBatchMonitorDialog={() => setBatchMonitorDialogOpen(true)}
        onSelectState={setSelectedNode}
        onDeselectEdge={() => setSelectedEdge(null)}
        onDeleteState={handleDeleteState}
      />

      {outgoingTransitionDialogOpen && preselectedOriginState && (
        <OutgoingTransitionBuilder
          preselectedOriginState={preselectedOriginState}
          onClose={() => {
            setOutgoingTransitionDialogOpen(false);
            setPreselectedOriginState(null);
          }}
        />
      )}

      <div className="flex-1 relative bg-surface-canvas min-h-0">
        <div
          className="absolute inset-0"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node: Node) => {
              if (node.type === "transitionNode") {
                const transitionId = node.id.replace("transition-node-", "");
                setSelectedEdge(transitionId);
                setSelectedNode(null);
              } else {
                setSelectedNode(node.id);
                setSelectedEdge(null);
              }
            }}
            onEdgeClick={(_, edge: Edge) => {
              setSelectedEdge(edge.id);
              setSelectedNode(null);
            }}
            onPaneClick={() => {
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
            fitView
            className="bg-surface-canvas"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#333"
            />
            <Controls className="bg-surface-raised border-border-default [&>button]:bg-surface-raised [&>button]:border-border-default [&>button]:text-white [&>button:hover]:bg-surface-raised/80" />
            <TransitionPositionManager
              transitions={transitions.filter(
                (t): t is OutgoingTransition => t.type === "OutgoingTransition"
              )}
              states={states}
              updateTransition={updateTransition}
            />
          </ReactFlow>
        </div>
      </div>

      {(selectedState || selectedTransition) && (
        <div className="w-[768px] border-l border-border-subtle bg-surface-raised/95 backdrop-blur-sm overflow-hidden flex flex-col animate-in slide-in-from-right duration-200">
          <div className="flex-1 overflow-y-auto scrollbar-dark p-4">
            {selectedState ? (
              <StatePropertiesPanel
                state={selectedState}
                allStates={states}
                images={images}
                incomingTransitions={transitions.filter(
                  (t): t is IncomingTransition =>
                    t.type === "IncomingTransition" &&
                    t.toState === selectedState.id
                )}
                workflows={workflows}
                updateState={updateSelectedState}
                addTransition={addTransition}
                updateTransition={updateTransition}
                deleteTransition={deleteTransition}
                addWorkflow={addWorkflow}
                addStateImage={addStateImage}
                updateStateImage={updateStateImage}
                removeStateImage={removeStateImage}
                moveStateImage={moveStateImage}
                addRegion={addRegion}
                updateRegion={updateRegion}
                removeRegion={removeRegion}
                addLocation={addLocation}
                updateLocation={updateLocation}
                removeLocation={removeLocation}
                addString={addString}
                updateString={updateString}
                removeString={removeString}
              />
            ) : selectedTransition ? (
              <TransitionPropertiesPanel
                transition={selectedTransition}
                states={states}
                processes={workflows}
                updateTransition={updateSelectedTransition}
                deleteTransition={(transitionId) => {
                  deleteTransition(transitionId);
                  setSelectedEdge(null);
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      <BatchMonitorSettingsDialog
        open={batchMonitorDialogOpen}
        onOpenChange={setBatchMonitorDialogOpen}
        states={states}
        onApplyMonitors={handleApplyMonitors}
      />
    </div>
  );
}
