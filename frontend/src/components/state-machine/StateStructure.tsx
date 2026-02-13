/**
 * State Structure Component
 *
 * Visual editor for the state machine graph using ReactFlow.
 * Manages state/transition nodes, edges, selection, and layout.
 */

"use client";

import React from "react";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Square, Trash2, Settings, Network } from "lucide-react";
import {
  ReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StateNode } from "@/components/state-node";
import { TransitionNode } from "@/components/transition-node";
import { TransitionEdge } from "@/components/transition-edge";
import {
  useStates,
  useTransitions,
  useImages,
  type State,
  type Transition,
  type OutgoingTransition,
  type IncomingTransition,
} from "@/hooks/automation";
import { useAutomation } from "@/contexts/automation-context";
import { StateUpdateCoordinator } from "@/contexts/automation-context/state-update-coordinator";
import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder";
import { StatePropertiesPanel } from "@/components/state-properties";
import { TransitionPropertiesPanel } from "@/components/transition-properties-panel";
import { BatchMonitorSettingsDialog } from "@/components/batch-monitor-settings-dialog";
import { getLayoutedElements } from "@/lib/layout-utils";
import { toast } from "sonner";
import { useStatesBridge } from "@/stores/page-state";
import { TransitionPositionManager } from "./TransitionPositionManager";
import { useStateElementCrud } from "./hooks/use-state-element-crud";
import { useImageDrag } from "./hooks/use-image-drag";
import { createLogger } from "@/lib/logger";
const logger = createLogger("StateStructure");

const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  transitionNode: TransitionNode,
};

const edgeTypes = {
  transitionEdge: TransitionEdge,
};

export function StateStructure() {
  // Get states from Zustand (for reading)
  const { states } = useStates();

  // Log when component mounts and when states change
  React.useEffect(() => {
    logger.info("[StateStructure] Component mounted/states changed:", {
      statesCount: states.length,
      stateIds: states.map((s) => s.id),
      stateNames: states.map((s) => s.name),
    });
  }, [states]);
  // Get transitions from Zustand for reading only
  const { transitions } = useTransitions();
  // Use state/transition mutations from Context (not Zustand) to ensure both stores are synced
  const {
    workflows,
    addWorkflow,
    updateWorkflow,
    addState,
    updateState,
    updateStateWithIdChange,
    deleteState,
    addTransition,
    updateTransition,
    deleteTransition,
  } = useAutomation();
  const { images } = useImages();

  // Use persisted page state for selected node (editingStateId)
  const pageState = useStatesBridge();
  const selectedNode = pageState.editingStateId;
  const setSelectedNode = pageState.setEditingStateId;

  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [batchMonitorDialogOpen, setBatchMonitorDialogOpen] = useState(false);
  const [outgoingTransitionDialogOpen, setOutgoingTransitionDialogOpen] =
    useState(false);
  const [preselectedOriginState, setPreselectedOriginState] = useState<
    string | null
  >(null);

  // Track pending ID changes to prevent panel from disappearing
  const pendingIdChangeRef = useRef<{ oldId: string; newId: string } | null>(
    null
  );

  // Track counts to trigger auto-layout when items are added
  const prevCountsRef = useRef({ stateCount: 0, transitionCount: 0 });

  // Track if a drag operation is in progress to prevent node destruction during drag
  const isDraggingRef = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // ==========================================================================
  // State update helper for selected state
  // ==========================================================================

  const updateSelectedState = (updates: Partial<State>) => {
    if (!selectedNode) return;

    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    // Use coordinator to prepare the update
    const updateResult = StateUpdateCoordinator.prepareStateUpdate(
      currentState,
      updates,
      states,
      transitions
    );

    if (updateResult.idChanged && updateResult.oldId && updateResult.newId) {
      // Track the pending ID change
      pendingIdChangeRef.current = {
        oldId: updateResult.oldId,
        newId: updateResult.newId,
      };

      // Update selectedNode to the new ID
      setSelectedNode(updateResult.newId);

      // Update the state with the new ID
      updateStateWithIdChange(updateResult.oldId, updateResult.updatedState);

      // Update all affected transitions
      const updatedTransitions =
        StateUpdateCoordinator.calculateUpdatedTransitions(
          transitions,
          updateResult.oldId,
          updateResult.newId
        );

      updatedTransitions.forEach((transition) => {
        const originalTransition = transitions.find(
          (t) => t.id === transition.id
        );
        if (
          originalTransition &&
          JSON.stringify(originalTransition) !== JSON.stringify(transition)
        ) {
          updateTransition(transition);
        }
      });

      // Update workflow tags that reference the old state ID
      workflows.forEach((workflow) => {
        if (workflow.tags?.includes(updateResult.oldId!)) {
          const updatedTags = workflow.tags.map((tag) =>
            tag === updateResult.oldId ? updateResult.newId! : tag
          );
          updateWorkflow({
            ...workflow,
            tags: updatedTags,
          });
        }
      });

      return;
    }

    // Simple update without ID change
    updateState(updateResult.updatedState);
  };

  // ==========================================================================
  // Extracted hooks
  // ==========================================================================

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

  const {
    handleStartImageDrag,
    handleDragOver,
    handleDrop,
  } = useImageDrag({
    states,
    transitions,
    workflows,
    addWorkflow,
    updateWorkflow,
    addTransition,
    updateTransition,
    updateState,
  });

  // ==========================================================================
  // Position and layout helpers
  // ==========================================================================

  const findEmptyPosition = useCallback(() => {
    const nodeWidth = 200;
    const nodeHeight = 100;
    const spacing = 50;
    const gridCols = 5;

    const occupiedPositions = [
      ...states.map((s) => s.position),
      ...transitions
        .filter(
          (t): t is OutgoingTransition =>
            t.type === "OutgoingTransition" &&
            Array.isArray(t.activateStates) &&
            t.activateStates.length > 1
        )
        .map((t) => t.position)
        .filter(Boolean),
    ];

    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < gridCols; col++) {
        const x = col * (nodeWidth + spacing) + 100;
        const y = row * (nodeHeight + spacing) + 100;

        const isOccupied = occupiedPositions.some(
          (pos) =>
            pos &&
            Math.abs(pos.x - x) < nodeWidth &&
            Math.abs(pos.y - y) < nodeHeight
        );

        if (!isOccupied) {
          return { x, y };
        }
      }
    }

    return {
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,
    };
  }, [states, transitions]);

  // ==========================================================================
  // Node/edge change handlers
  // ==========================================================================

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((change) => {
        if (change.type === "position") {
          if (change.dragging === true) {
            isDraggingRef.current = true;
          } else if (change.dragging === false) {
            isDraggingRef.current = false;
          }
        }
      });

      onNodesChange(changes);

      changes.forEach((change) => {
        if (
          change.type === "position" &&
          change.dragging === false &&
          change.position &&
          change.id
        ) {
          const state = states.find((s) => s.id === change.id);
          if (state) {
            updateState({
              ...state,
              position: {
                x: Math.round(change.position.x),
                y: Math.round(change.position.y),
              },
            });
          } else if (change.id.startsWith("transition-node-")) {
            const transitionId = change.id.replace("transition-node-", "");
            const transition = transitions.find((t) => t.id === transitionId);
            if (transition) {
              updateTransition({
                ...transition,
                position: {
                  x: Math.round(change.position.x),
                  y: Math.round(change.position.y),
                },
              });
            }
          }
        }
      });
    },
    [onNodesChange, states, updateState, transitions, updateTransition]
  );

  const handleAddOutgoingTransition = useCallback((stateId: string) => {
    setPreselectedOriginState(stateId);
    setOutgoingTransitionDialogOpen(true);
  }, []);

  // ==========================================================================
  // Build nodes/edges from state data
  // ==========================================================================

  React.useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }

    const incomingTransitionsByState = new Map<string, IncomingTransition[]>();
    transitions
      .filter((t): t is IncomingTransition => t.type === "IncomingTransition")
      .forEach((t) => {
        const existing = incomingTransitionsByState.get(t.toState) || [];
        incomingTransitionsByState.set(t.toState, [...existing, t]);
      });

    const outgoingTransitionsByState = new Set<string>();
    transitions
      .filter((t): t is OutgoingTransition => t.type === "OutgoingTransition")
      .forEach((t) => {
        outgoingTransitionsByState.add(t.fromState);
      });

    const stateNodes: Node[] = states.map((state) => ({
      id: state.id,
      type: "stateNode",
      position: state.position,
      data: {
        state: { ...state },
        images,
        hasIncomingTransitions: incomingTransitionsByState.has(state.id),
        incomingTransitions: incomingTransitionsByState.get(state.id) || [],
        hasOutgoingTransitions: outgoingTransitionsByState.has(state.id),
        onAddOutgoingTransition: handleAddOutgoingTransition,
        onStartImageDrag: handleStartImageDrag,
      },
    }));

    const transitionNodes: Node[] = [];
    const newEdges: Edge[] = [];

    transitions
      .filter((t): t is OutgoingTransition => t.type === "OutgoingTransition")
      .forEach((transition) => {
        const activateStates = Array.isArray(transition.activateStates)
          ? transition.activateStates
          : [];
        const isMultiTarget = activateStates.length > 1;

        const transitionNodeId = `transition-node-${transition.id}`;
        const sourceState = states.find((s) => s.id === transition.fromState);

        if (sourceState && activateStates.length > 0) {
          const nodeWidth = 200;
          const estimatedSourceHeight = 150;

          let position = transition.position;

          if (!position) {
            const firstTargetState = states.find(
              (s) => s.id === activateStates[0]
            );
            if (firstTargetState) {
              const sourceBottomY =
                sourceState.position.y + estimatedSourceHeight;
              const targetTopY = firstTargetState.position.y;
              const midpointY = (sourceBottomY + targetTopY) / 2;

              position = {
                x:
                  (sourceState.position.x + firstTargetState.position.x) / 2 +
                  nodeWidth / 2,
                y: midpointY,
              };
            } else {
              position = {
                x: sourceState.position.x + nodeWidth / 2,
                y: sourceState.position.y + 200,
              };
            }
          }

          const transitionNode: Node = {
            id: transitionNodeId,
            type: "transitionNode",
            position: position,
            data: {
              transition,
              label: isMultiTarget ? `→ ${activateStates.length} states` : `→`,
              isSingleTarget: !isMultiTarget,
            },
          };
          transitionNodes.push(transitionNode);

          newEdges.push({
            id: `${transition.id}-source`,
            source: transition.fromState,
            target: transitionNodeId,
            type: "transitionEdge",
            data: { transition, isMultiTarget: true },
            style: { stroke: "var(--brand-secondary)", strokeWidth: 2 },
          });

          activateStates.forEach((targetState, index) => {
            newEdges.push({
              id: `${transition.id}-target-${index}`,
              source: transitionNodeId,
              target: targetState,
              type: "transitionEdge",
              data: { transition, isMultiTarget: isMultiTarget },
              animated: true,
            });
          });
        }
      });

    const newNodes = [...stateNodes, ...transitionNodes];

    logger.info("[StateStructure] useEffect triggered - rebuilding nodes:", {
      statesCount: states.length,
      stateIds: states.map((s) => s.id),
      stateNodesCount: stateNodes.length,
      transitionNodesCount: transitionNodes.length,
      totalNodes: newNodes.length,
      edgesCount: newEdges.length,
      isDragging: isDraggingRef.current,
      nodeDetails: newNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
      })),
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [
    states,
    transitions,
    images,
    setNodes,
    setEdges,
    handleAddOutgoingTransition,
    handleStartImageDrag,
  ]);

  // ==========================================================================
  // State/transition CRUD handlers
  // ==========================================================================

  const handleAddState = () => {
    const position = findEmptyPosition();
    logger.info("[StateStructure] handleAddState - position:", position);
    const newState = StateUpdateCoordinator.createDefaultState(
      states,
      position
    );
    logger.info("[StateStructure] handleAddState - newState:", newState);
    addState(newState);
  };

  const handleDeleteState = (stateId: string) => {
    deleteState(stateId);
    if (selectedNode === stateId) setSelectedNode(null);
  };

  const handleApplyMonitors = useCallback(
    async (stateIds: string[], monitors: number[]) => {
      const updates = stateIds.map(async (stateId) => {
        const state = states.find((s) => s.id === stateId);
        if (state && state.stateImages) {
          const updatedState = {
            ...state,
            stateImages: state.stateImages.map((si) => ({
              ...si,
              monitors: monitors,
            })),
          };
          await updateState(updatedState);
        }
      });
      await Promise.all(updates);
    },
    [states, updateState]
  );

  const applyAutoLayout = useCallback(() => {
    const { nodes: layoutedNodes } = getLayoutedElements(nodes, edges, {
      direction: "TB",
      nodeWidth: 200,
      nodeHeight: 150,
      nodeSep: 80,
      rankSep: 120,
    });

    layoutedNodes.forEach((node) => {
      const state = states.find((s) => s.id === node.id);
      if (state) {
        updateState({
          ...state,
          position: {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          },
        });
      } else if (node.id.startsWith("transition-node-")) {
        const transitionId = node.id.replace("transition-node-", "");
        const transition = transitions.find((t) => t.id === transitionId);
        if (transition) {
          updateTransition({
            ...transition,
            position: {
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
            },
          });
        }
      }
    });
  }, [nodes, edges, states, transitions, updateState, updateTransition]);

  // Auto-layout when states are added
  React.useEffect(() => {
    const currentCounts = {
      stateCount: states.length,
      transitionCount: transitions.length,
    };

    if (currentCounts.stateCount > prevCountsRef.current.stateCount) {
      setTimeout(() => {
        applyAutoLayout();
      }, 150);
    }

    prevCountsRef.current = currentCounts;
  }, [states.length, transitions.length, applyAutoLayout]);

  const onConnect = useCallback(
    async (params: Connection) => {
      if (!params.source || !params.target) return;

      const newTransition: OutgoingTransition = {
        id: `transition-${Date.now()}`,
        type: "OutgoingTransition",
        fromState: params.source,
        activateStates: [params.target],
        staysVisible: false,
        deactivateStates: [],
        workflows: [],
        timeout: 30000,
        retryCount: 0,
      };

      const wasAdded = await addTransition(newTransition);
      if (!wasAdded) {
        toast.error("A transition between these states already exists");
      }
    },
    [addTransition]
  );

  const updateSelectedTransition = (updates: Partial<Transition>) => {
    if (!selectedEdge) return;

    const currentTransition = transitions.find((t) =>
      selectedEdge.startsWith(t.id)
    );
    if (!currentTransition) return;

    const updatedTransition = {
      ...currentTransition,
      ...updates,
    } as Transition;
    updateTransition(updatedTransition);
  };

  // ==========================================================================
  // Selected state/transition derivation
  // ==========================================================================

  const selectedState = React.useMemo(() => {
    if (!selectedNode) return null;

    const exactMatch = states.find((s) => s.id === selectedNode);
    if (exactMatch) {
      pendingIdChangeRef.current = null;
      return exactMatch;
    }

    if (pendingIdChangeRef.current) {
      const { oldId, newId } = pendingIdChangeRef.current;
      if (selectedNode === newId) {
        const oldState = states.find((s) => s.id === oldId);
        if (oldState) {
          return oldState;
        }
      }
    }

    return null;
  }, [selectedNode, states]);

  const selectedTransition = selectedEdge
    ? transitions.find((t) => {
        if (t.id === selectedEdge) return true;
        if (
          selectedEdge.startsWith(t.id + "-") &&
          t.type === "OutgoingTransition"
        ) {
          return true;
        }
        return false;
      })
    : null;

  // ==========================================================================
  // Loading state
  // ==========================================================================

  if (pageState.isHydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-muted">Loading page state...</div>
      </div>
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-80 border-r border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto scrollbar-dark">
        <div className="space-y-4">
          <Button
            onClick={handleAddState}
            className="w-full bg-[var(--brand-secondary)] hover:bg-[var(--brand-secondary)]/80 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add State
          </Button>

          <Button
            onClick={applyAutoLayout}
            className="w-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/80 text-black"
          >
            <Network className="w-4 h-4 mr-2" />
            Auto Layout
          </Button>

          <Button
            onClick={() => setBatchMonitorDialogOpen(true)}
            className="w-full bg-[#7C3AED] hover:bg-[#7C3AED]/80 text-white"
            disabled={states.length === 0}
          >
            <Settings className="w-4 h-4 mr-2" />
            Batch Monitor Settings
          </Button>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-text-muted uppercase tracking-wide">
              States
            </h3>
            {states.length === 0 ? (
              <div className="text-center py-8 text-text-muted">
                <Square className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No states yet</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-dark">
                {states.map((state) => (
                  <div
                    key={state.id}
                    className={`flex items-center gap-2 p-2 rounded transition-colors cursor-pointer ${
                      selectedNode === state.id
                        ? "bg-[var(--brand-secondary)]/20 border border-[var(--brand-secondary)]"
                        : "hover:bg-surface-raised/80"
                    }`}
                    onClick={() => {
                      setSelectedNode(state.id);
                      setSelectedEdge(null);
                    }}
                  >
                    <span className="text-sm flex-1 truncate">
                      {state.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteState(state.id);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-text-muted uppercase tracking-wide">
              Transitions
            </h3>
            <OutgoingTransitionBuilder />
          </div>
        </div>
      </div>

      {/* Outgoing Transition Dialog triggered by green circle */}
      {outgoingTransitionDialogOpen && preselectedOriginState && (
        <OutgoingTransitionBuilder
          preselectedOriginState={preselectedOriginState}
          onClose={() => {
            setOutgoingTransitionDialogOpen(false);
            setPreselectedOriginState(null);
          }}
        />
      )}

      {/* Main Canvas */}
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

      {/* Right Panel - only shown when a state or transition is selected */}
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

      {/* Batch Monitor Settings Dialog */}
      <BatchMonitorSettingsDialog
        open={batchMonitorDialogOpen}
        onOpenChange={setBatchMonitorDialogOpen}
        states={states}
        onApplyMonitors={handleApplyMonitors}
      />
    </div>
  );
}
