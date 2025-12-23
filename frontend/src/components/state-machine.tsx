"use client";

import React from "react";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Square, Trash2, Settings, Network } from "lucide-react";
import {
  ReactFlow,
  useReactFlow,
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
  type StateRegion,
  type StateLocation,
  type StateString,
  type StateImage,
  type Pattern,
  type Transition,
  type OutgoingTransition,
  type IncomingTransition,
} from "@/hooks/automation";
import { useAutomation } from "@/contexts/automation-context";
import { StateUpdateCoordinator } from "@/stores/automation";
import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder";
import { StatePropertiesPanel } from "@/components/state-properties-panel";
import { TransitionPropertiesPanel } from "@/components/transition-properties-panel";
import { BatchMonitorSettingsDialog } from "@/components/batch-monitor-settings-dialog";
import { getLayoutedElements } from "@/lib/layout-utils";
import {
  createClickStateImageWorkflow,
  createFindStateWorkflow,
} from "@/lib/workflow-helpers";
import { toast } from "sonner";
import { useStatesBridge } from "@/stores/page-state";

const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  transitionNode: TransitionNode,
};

const edgeTypes = {
  transitionEdge: TransitionEdge,
};

// Helper component to calculate transition positions using measured node dimensions
// Must be rendered inside ReactFlow to access useReactFlow hook
interface TransitionPositionManagerProps {
  transitions: OutgoingTransition[];
  states: State[];
  updateTransition: (transition: Transition) => void;
}

function TransitionPositionManager({
  transitions,
  states,
  updateTransition,
}: TransitionPositionManagerProps) {
  const { getNodes } = useReactFlow();

  React.useEffect(() => {
    // Find transitions that need positions to be saved
    const transitionsNeedingPositions = transitions.filter(
      (t) =>
        !t.position &&
        Array.isArray(t.activateStates) &&
        t.activateStates.length > 0
    );

    if (transitionsNeedingPositions.length === 0) return;

    // Get measured nodes from ReactFlow
    const measuredNodes = getNodes();

    transitionsNeedingPositions.forEach((transition) => {
      const sourceState = states.find((s) => s.id === transition.fromState);
      if (!sourceState) return;

      // Get the measured source node to get actual height
      const sourceNode = measuredNodes.find(
        (n) => n.id === transition.fromState
      );
      const sourceHeight =
        sourceNode?.measured?.height ?? sourceNode?.height ?? 150;
      const sourceWidth =
        sourceNode?.measured?.width ?? sourceNode?.width ?? 200;

      const firstTargetState = states.find(
        (s) => s.id === transition.activateStates[0]
      );

      let proposedPosition;

      // Transition node size (p-2 padding + 16px icon = ~32px)
      // We need to offset so the CENTER of the circle is at the midpoint
      const transitionNodeSize = 32;
      const halfNodeSize = transitionNodeSize / 2;

      if (firstTargetState) {
        // Calculate the midpoint between source bottom handle and target top handle
        // Using actual measured height for source node
        const sourceBottomY = sourceState.position.y + sourceHeight;
        const targetTopY = firstTargetState.position.y;
        const midpointY = (sourceBottomY + targetTopY) / 2;
        const midpointX =
          (sourceState.position.x + firstTargetState.position.x) / 2 +
          sourceWidth / 2;

        // Offset so the circle's CENTER is at the midpoint (position is top-left corner)
        proposedPosition = {
          x: midpointX - halfNodeSize,
          y: midpointY - halfNodeSize,
        };
      } else {
        // Fallback if target not found - place below center of source
        proposedPosition = {
          x: sourceState.position.x + sourceWidth / 2 - halfNodeSize,
          y: sourceState.position.y + sourceHeight + 50 - halfNodeSize,
        };
      }

      // Check if this position is occupied
      const isOccupied = [
        ...states,
        ...transitions.filter((t) => t.position),
      ].some((item) => {
        const pos = "position" in item ? item.position : item.position;
        return (
          pos &&
          Math.abs(pos.x - proposedPosition.x) < 100 &&
          Math.abs(pos.y - proposedPosition.y) < 60
        );
      });

      const finalPosition = isOccupied
        ? { x: sourceState.position.x + 150, y: sourceState.position.y + 50 }
        : proposedPosition;

      // Save the position
      updateTransition({
        ...transition,
        position: {
          x: Math.round(finalPosition.x),
          y: Math.round(finalPosition.y),
        },
      });
    });
  }, [transitions, states, updateTransition, getNodes]);

  return null; // This component doesn't render anything
}

export function StateStructure() {
  // Get states from Zustand (for reading)
  const { states } = useStates();

  // Log when component mounts and when states change
  React.useEffect(() => {
    console.log("[StateStructure] Component mounted/states changed:", {
      statesCount: states.length,
      stateIds: states.map((s) => s.id),
      stateNames: states.map((s) => s.name),
    });
  }, [states]);
  // Get transitions from Zustand for reading only
  const { transitions } = useTransitions();
  // Use state/transition mutations from Context (not Zustand) to ensure both stores are synced
  // This is critical for export functionality which reads from Context
  const {
    workflows,
    addWorkflow,
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

  // State for tracking image drag operations for creating transitions
  const [_imageDragData, setImageDragData] = useState<{
    sourceStateId: string;
    stateImageId: string;
  } | null>(null);

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

  // Helper function to find an empty space for a new node
  const findEmptyPosition = useCallback(() => {
    const nodeWidth = 200;
    const nodeHeight = 100;
    const spacing = 50;
    const gridCols = 5;

    // Get all occupied positions
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

    // Try to find an empty grid position
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < gridCols; col++) {
        const x = col * (nodeWidth + spacing) + 100;
        const y = row * (nodeHeight + spacing) + 100;

        // Check if this position overlaps with any existing node
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

    // Fallback to random position if grid is full
    return {
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,
    };
  }, [states, transitions]);

  // Handle node position changes
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Track drag start/end to prevent node destruction during drag
      changes.forEach((change) => {
        if (change.type === "position") {
          if (change.dragging === true) {
            isDraggingRef.current = true;
          } else if (change.dragging === false) {
            isDraggingRef.current = false;
          }
        }
      });

      // Call the original handler
      onNodesChange(changes);

      // Update positions when nodes finish dragging (dragging === false means drag ended)
      changes.forEach((change) => {
        if (
          change.type === "position" &&
          change.dragging === false &&
          change.position &&
          change.id
        ) {
          // Check if it's a state node
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
            // It's a transition node, extract the transition ID
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

  // Note: Transition position calculation is now handled by TransitionPositionManager
  // component inside ReactFlow, which has access to actual measured node dimensions

  // Handler for adding outgoing transition from a state
  const handleAddOutgoingTransition = useCallback((stateId: string) => {
    setPreselectedOriginState(stateId);
    setOutgoingTransitionDialogOpen(true);
  }, []);

  // Handler for starting an image drag operation
  const handleStartImageDrag = useCallback(
    (stateId: string, stateImageId: string) => {
      setImageDragData({ sourceStateId: stateId, stateImageId });
    },
    []
  );

  // Handler for creating a transition by dropping an image on a target state
  const handleImageDropOnState = useCallback(
    async (
      targetStateId: string,
      dragData: { sourceStateId: string; stateImageId: string }
    ) => {
      const { sourceStateId, stateImageId } = dragData;

      // Don't create transition to the same state
      if (targetStateId === sourceStateId) {
        toast.error("Cannot create a transition to the same state");
        return;
      }

      // Find the source state and state image
      const sourceState = states.find((s) => s.id === sourceStateId);
      const targetState = states.find((s) => s.id === targetStateId);
      if (!sourceState || !targetState) {
        toast.error("Could not find states");
        return;
      }

      const stateImage = sourceState.stateImages?.find(
        (img) => img.id === stateImageId
      );
      if (!stateImage) {
        toast.error("Could not find state image");
        return;
      }

      // Check if a transition from this state to target already exists BEFORE creating workflows
      const existingOutgoingTransition = transitions.find(
        (t): t is OutgoingTransition =>
          t.type === "OutgoingTransition" &&
          t.fromState === sourceStateId &&
          t.activateStates.includes(targetStateId)
      );

      if (existingOutgoingTransition) {
        toast.error(
          `A transition from "${sourceState.name}" to "${targetState.name}" already exists`
        );
        setImageDragData(null);
        return;
      }

      // Find existing "Click" workflow for this stateImage, or create a new one
      const expectedClickName = `Click: ${stateImage.name}`;
      let clickWorkflow = workflows.find(
        (w) =>
          w.name === expectedClickName &&
          w.category === "Outgoing Transitions" &&
          w.tags?.includes(sourceState.id)
      );

      if (!clickWorkflow) {
        clickWorkflow = createClickStateImageWorkflow(sourceState, stateImage);
        addWorkflow(clickWorkflow);
      }

      // Find existing "Find State" workflow for the target state, or create a new one
      const expectedFindName = `Find State: ${targetState.name}`;
      let findWorkflow = workflows.find(
        (w) =>
          w.name === expectedFindName &&
          w.category === "Incoming Transitions" &&
          w.tags?.includes(targetState.id)
      );

      if (!findWorkflow) {
        findWorkflow = createFindStateWorkflow(targetState);
        addWorkflow(findWorkflow);
      }

      // Create the outgoing transition with the click workflow
      const outgoingTransition: OutgoingTransition = {
        id: `transition-${Date.now()}`,
        type: "OutgoingTransition",
        fromState: sourceStateId,
        activateStates: [targetStateId],
        staysVisible: false,
        deactivateStates: [],
        workflows: [clickWorkflow.id],
        timeout: 30000,
        retryCount: 0,
      };
      await addTransition(outgoingTransition);

      // Check if the target state already has an incoming transition
      const existingIncomingTransition = transitions.find(
        (t): t is IncomingTransition =>
          t.type === "IncomingTransition" && t.toState === targetStateId
      );

      if (existingIncomingTransition) {
        // Update the existing incoming transition to add the find workflow if not already present
        if (!existingIncomingTransition.workflows.includes(findWorkflow.id)) {
          updateTransition({
            ...existingIncomingTransition,
            workflows: [
              ...existingIncomingTransition.workflows,
              findWorkflow.id,
            ],
          });
        }
      } else {
        // Create a new incoming transition with the find workflow
        const incomingTransition: IncomingTransition = {
          id: `incoming-${Date.now()}`,
          type: "IncomingTransition",
          toState: targetStateId,
          workflows: [findWorkflow.id],
          timeout: 10000,
          retryCount: 3,
        };
        await addTransition(incomingTransition);
      }

      toast.success(
        `Created transition from "${sourceState.name}" to "${targetState.name}" by clicking "${stateImage.name}"`
      );
      setImageDragData(null);
    },
    [states, transitions, workflows, addWorkflow, addTransition, updateTransition]
  );

  // Handler for moving a StateImage to another state via Alt+drag
  const handleImageMoveToState = useCallback(
    (
      targetStateId: string,
      dragData: {
        sourceStateId: string;
        stateImageId: string;
        stateImageName: string;
      }
    ) => {
      const { sourceStateId, stateImageId, stateImageName } = dragData;

      // Don't move to the same state
      if (targetStateId === sourceStateId) {
        toast.error("Cannot move to the same state");
        return;
      }

      // Find the source and target states
      const sourceState = states.find((s) => s.id === sourceStateId);
      const targetState = states.find((s) => s.id === targetStateId);
      if (!sourceState || !targetState) {
        toast.error("Could not find states");
        return;
      }

      // Find the StateImage index
      const stateImageIndex = sourceState.stateImages?.findIndex(
        (img) => img.id === stateImageId
      );
      if (stateImageIndex === undefined || stateImageIndex === -1) {
        toast.error("Could not find state image");
        return;
      }

      // Get the StateImage to move
      const stateImageToMove = sourceState.stateImages?.[stateImageIndex];
      if (!stateImageToMove) {
        toast.error("Could not find state image");
        return;
      }

      // Remove from source state
      const updatedSourceStateImages = (sourceState.stateImages || []).filter(
        (_, i) => i !== stateImageIndex
      );
      updateState({
        ...sourceState,
        stateImages: updatedSourceStateImages,
      });

      // Add to target state
      const updatedTargetStateImages: typeof sourceState.stateImages = [
        ...(targetState.stateImages || []),
        stateImageToMove,
      ];
      updateState({
        ...targetState,
        stateImages: updatedTargetStateImages,
      });

      toast.success(`Moved "${stateImageName}" to "${targetState.name}"`);
      setImageDragData(null);
    },
    [states, updateState]
  );

  // Handle drag over on the canvas
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    // Check if this is a move operation by looking at the drag data
    // We can't access the actual data during dragover, so we rely on effectAllowed
    event.dataTransfer.dropEffect = "link";
  }, []);

  // Handle drop on the canvas - determine which state node was targeted
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      // Try to get the drag data
      const dragDataStr = event.dataTransfer.getData(
        "application/stateimage-drag"
      );
      if (!dragDataStr) {
        return;
      }

      try {
        const dragData = JSON.parse(dragDataStr);

        // Find which node the drop is over by checking the target
        // We need to traverse up the DOM to find a state node
        let target = event.target as HTMLElement;
        let targetStateId: string | null = null;

        while (target && !targetStateId) {
          // Check if this element is a ReactFlow node
          const nodeId = target.getAttribute("data-id");
          if (nodeId && states.some((s) => s.id === nodeId)) {
            targetStateId = nodeId;
            break;
          }
          target = target.parentElement as HTMLElement;
        }

        if (targetStateId) {
          // Check if this is a move operation (Alt+drag)
          if (dragData.isMoveOperation) {
            handleImageMoveToState(targetStateId, dragData);
          } else {
            handleImageDropOnState(targetStateId, dragData);
          }
        } else {
          // Clear drag data if dropped on nothing
          setImageDragData(null);
        }
      } catch (e) {
        console.error("Failed to parse drag data:", e);
        setImageDragData(null);
      }
    },
    [states, handleImageDropOnState, handleImageMoveToState]
  );

  React.useEffect(() => {
    // Skip rebuilding nodes while dragging to prevent node destruction
    if (isDraggingRef.current) {
      return;
    }

    // Check which states have IncomingTransitions
    // Map incoming transitions by state
    const incomingTransitionsByState = new Map<string, IncomingTransition[]>();
    transitions
      .filter((t): t is IncomingTransition => t.type === "IncomingTransition")
      .forEach((t) => {
        const existing = incomingTransitionsByState.get(t.toState) || [];
        incomingTransitionsByState.set(t.toState, [...existing, t]);
      });

    // Check which states have OutgoingTransitions
    const outgoingTransitionsByState = new Set<string>();
    transitions
      .filter((t): t is OutgoingTransition => t.type === "OutgoingTransition")
      .forEach((t) => {
        outgoingTransitionsByState.add(t.fromState);
      });

    // Create state nodes
    const stateNodes: Node[] = states.map((state) => ({
      id: state.id,
      type: "stateNode",
      position: state.position,
      data: {
        state: { ...state }, // Spread to create new reference for React to detect changes
        images,
        hasIncomingTransitions: incomingTransitionsByState.has(state.id),
        incomingTransitions: incomingTransitionsByState.get(state.id) || [],
        hasOutgoingTransitions: outgoingTransitionsByState.has(state.id),
        onAddOutgoingTransition: handleAddOutgoingTransition,
        onStartImageDrag: handleStartImageDrag,
      },
    }));

    // Create transition nodes and edges
    const transitionNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // First, handle OutgoingTransitions
    transitions
      .filter((t): t is OutgoingTransition => t.type === "OutgoingTransition")
      .forEach((transition) => {
        // Ensure activateStates is an array before accessing it
        const activateStates = Array.isArray(transition.activateStates)
          ? transition.activateStates
          : [];
        const isMultiTarget = activateStates.length > 1;
        const transitionNodeId = `transition-node-${transition.id}`;
        const sourceState = states.find((s) => s.id === transition.fromState);

        if (sourceState && activateStates.length > 0) {
          // Create a transition node for all transitions (both single and multi-target)
          // Use saved position or calculate a temporary position for initial display.
          // The TransitionPositionManager (inside ReactFlow) will calculate the correct
          // position using actual measured node dimensions and save it.
          let position = transition.position;

          // Fallback dimensions (only used until TransitionPositionManager calculates correct position)
          const nodeWidth = 200;
          const estimatedSourceHeight = 150;

          if (!position) {
            // Calculate temporary position - midpoint between source bottom and target top
            const firstTargetState = states.find(
              (s) => s.id === activateStates[0]
            );
            if (firstTargetState) {
              // Calculate the midpoint between source bottom handle and target top handle
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
              // Fallback if target not found - place below center of source
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

          // Create edge from source state to transition node
          newEdges.push({
            id: `${transition.id}-source`,
            source: transition.fromState,
            target: transitionNodeId,
            type: "transitionEdge",
            data: { transition, isMultiTarget: true },
            style: { stroke: "#BD00FF", strokeWidth: 2 },
          });

          // Create edges from transition node to each target state
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

    // IncomingTransitions are now shown as badges on state nodes
    // No need to create separate nodes and edges for them

    const newNodes = [...stateNodes, ...transitionNodes];

    console.log("[StateStructure] useEffect triggered - rebuilding nodes:", {
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

  const handleAddState = () => {
    const position = findEmptyPosition();
    console.log("[StateStructure] handleAddState - position:", position);
    const newState = StateUpdateCoordinator.createDefaultState(
      states,
      position
    );
    console.log("[StateStructure] handleAddState - newState:", newState);
    addState(newState);
    // Auto-layout is handled by useEffect watching states.length
  };

  const handleDeleteState = (stateId: string) => {
    deleteState(stateId);
    if (selectedNode === stateId) setSelectedNode(null);
  };

  const handleApplyMonitors = useCallback(
    (stateIds: string[], monitors: number[]) => {
      // Apply monitors to all state images in selected states
      stateIds.forEach((stateId) => {
        const state = states.find((s) => s.id === stateId);
        if (state && state.stateImages) {
          const updatedState = {
            ...state,
            stateImages: state.stateImages.map((si) => ({
              ...si,
              monitors: monitors,
            })),
          };
          updateState(updatedState);
        }
      });
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

    // Update positions in the state
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

  // Auto-layout when states are added (NOT when transitions are added)
  React.useEffect(() => {
    const currentCounts = {
      stateCount: states.length,
      transitionCount: transitions.length,
    };

    // Only auto-layout when states are added, not transitions
    // This prevents target states from moving when transitions are created
    if (currentCounts.stateCount > prevCountsRef.current.stateCount) {
      // Delay to ensure nodes/edges are rendered
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
        activateStates: [params.target], // Target state is just the first in activateStates
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

      // Update all affected transitions (can be async)
      const updatedTransitions =
        StateUpdateCoordinator.calculateUpdatedTransitions(
          transitions,
          updateResult.oldId,
          updateResult.newId
        );

      // Apply transition updates
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

      return;
    }

    // Simple update without ID change
    updateState(updateResult.updatedState);
  };

  const updateSelectedTransition = (updates: Partial<Transition>) => {
    if (!selectedEdge) return;

    // Extract the transition ID from the edge ID (remove the "-index" suffix)
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

  // StateImage management
  const addStateImage = () => {
    if (!selectedNode) return;

    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    // Create a default pattern for the new StateImage
    const newPattern: Pattern = {
      id: `pattern_${Date.now()}`,
      imageId: "",
      searchRegions: [],
      fixed: false,
    };

    const newStateImage: StateImage = {
      id: `stateimage-${Date.now()}`,
      name: `StateImage_${(currentState.stateImages?.length || 0) + 1}`,
      patterns: [newPattern],
      shared: false,
      source: "upload", // Mark this as an uploaded image
      probability: 1.0, // Default: always appears in mock tests
    };
    const updatedStateImages = [
      ...(currentState.stateImages || []),
      newStateImage,
    ];
    updateSelectedState({ stateImages: updatedStateImages });
  };

  const updateStateImage = (index: number, updates: Partial<StateImage>) => {
    if (!selectedNode) return;

    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState || !currentState.stateImages) return;

    const updatedStateImages = [...currentState.stateImages];
    updatedStateImages[index] = {
      ...updatedStateImages[index],
      ...updates,
    } as StateImage;
    updateSelectedState({ stateImages: updatedStateImages });
  };

  const removeStateImage = (index: number) => {
    if (!selectedNode) return;

    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState || !currentState.stateImages) return;

    const updatedStateImages = currentState.stateImages.filter(
      (_, i) => i !== index
    );
    updateSelectedState({ stateImages: updatedStateImages });
  };

  const moveStateImage = (stateImageIndex: number, targetStateId: string) => {
    if (!selectedNode) return;

    const sourceState = states.find((s) => s.id === selectedNode);
    const targetState = states.find((s) => s.id === targetStateId);
    if (!sourceState || !targetState) return;
    if (
      !sourceState.stateImages ||
      stateImageIndex >= sourceState.stateImages.length
    )
      return;

    // Get the StateImage to move
    const stateImageToMove = sourceState.stateImages[stateImageIndex];
    if (!stateImageToMove) return;

    // Remove from source state
    const updatedSourceStateImages = sourceState.stateImages.filter(
      (_, i) => i !== stateImageIndex
    );
    updateState({
      ...sourceState,
      stateImages: updatedSourceStateImages,
    });

    // Add to target state
    const updatedTargetStateImages: typeof sourceState.stateImages = [
      ...(targetState.stateImages || []),
      stateImageToMove,
    ];
    updateState({
      ...targetState,
      stateImages: updatedTargetStateImages,
    });

    toast.success(`Moved "${stateImageToMove.name}" to "${targetState.name}"`);
  };

  // Region management
  const addRegion = () => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const regions = currentState.regions || [];
    const newRegion: StateRegion = {
      id: `region-${Date.now()}`,
      name: `Region ${regions.length + 1}`,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      monitors: [0], // Default to primary monitor
    };
    updateSelectedState({ regions: [...regions, newRegion] });
  };

  const updateRegion = (
    index: number,
    field: keyof StateRegion,
    value: unknown
  ) => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const regions = currentState.regions || [];
    const updatedRegions = [...regions];
    updatedRegions[index] = {
      ...updatedRegions[index],
      [field]: value,
    } as StateRegion;
    updateSelectedState({ regions: updatedRegions });
  };

  const removeRegion = (index: number) => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const regions = currentState.regions || [];
    const updatedRegions = regions.filter((_, i) => i !== index);
    updateSelectedState({ regions: updatedRegions });
  };

  // Location management
  const addLocation = () => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const locations = currentState.locations || [];
    const newLocation: StateLocation = {
      id: `location-${Date.now()}`,
      name: `Location ${locations.length + 1}`,
      x: 0,
      y: 0,
      fixed: true, // Default to absolute positioning
      anchor: false, // Not an anchor by default
      offsetX: 0,
      offsetY: 0,
      monitors: [0], // Default to primary monitor
    };
    updateSelectedState({ locations: [...locations, newLocation] });
  };

  const updateLocation = (
    index: number,
    field: keyof StateLocation,
    value: unknown
  ) => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const locations = currentState.locations || [];
    const updatedLocations = [...locations];
    updatedLocations[index] = {
      ...updatedLocations[index],
      [field]: value,
    } as StateLocation;
    updateSelectedState({ locations: updatedLocations });
  };

  const removeLocation = (index: number) => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const locations = currentState.locations || [];
    const updatedLocations = locations.filter((_, i) => i !== index);
    updateSelectedState({ locations: updatedLocations });
  };

  // String management
  const addString = () => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const strings = currentState.strings || [];
    const newString: StateString = {
      id: `string-${Date.now()}`,
      name: `String ${strings.length + 1}`,
      value: "",
      inputText: true, // DEFAULT: Input Text is checked
    };
    updateSelectedState({ strings: [...strings, newString] });
  };

  const updateString = (
    index: number,
    field: keyof StateString,
    value: unknown
  ) => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const strings = currentState.strings || [];
    const updatedStrings = [...strings];
    updatedStrings[index] = {
      ...updatedStrings[index],
      [field]: value,
    } as StateString;
    updateSelectedState({ strings: updatedStrings });
  };

  const removeString = (index: number) => {
    if (!selectedNode) return;
    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const strings = currentState.strings || [];
    const updatedStrings = strings.filter((_, i) => i !== index);
    updateSelectedState({ strings: updatedStrings });
  };

  // Find selected state - use a fallback strategy to handle ID changes during typing
  const selectedState = React.useMemo(() => {
    if (!selectedNode) return null;

    // First try to find by exact ID match
    const exactMatch = states.find((s) => s.id === selectedNode);
    if (exactMatch) {
      // Clear pending ID change if we found the state
      pendingIdChangeRef.current = null;
      return exactMatch;
    }

    // If not found and we have a pending ID change, look for the old ID
    if (pendingIdChangeRef.current) {
      const { oldId, newId } = pendingIdChangeRef.current;

      // If selectedNode matches the newId but we can't find it yet,
      // try to find the oldId temporarily
      if (selectedNode === newId) {
        const oldState = states.find((s) => s.id === oldId);
        if (oldState) {
          return oldState;
        }
      }
    }

    return null;
  }, [selectedNode, states]);

  // Extract the transition ID from the edge ID or direct transition ID
  const selectedTransition = selectedEdge
    ? transitions.find((t) => {
        // Handle direct transition IDs (from clicking transition nodes)
        if (t.id === selectedEdge) return true;

        // Handle outgoing transition edge IDs with suffixes
        if (
          selectedEdge.startsWith(t.id + "-") &&
          t.type === "OutgoingTransition"
        ) {
          return true;
        }

        return false;
      })
    : null;

  // Show loading state while hydrating page state
  if (pageState.isHydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading page state...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-80 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <Button
            onClick={handleAddState}
            className="w-full bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add State
          </Button>

          <Button
            onClick={applyAutoLayout}
            className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
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
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
              States
            </h3>
            {states.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Square className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No states yet</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {states.map((state) => (
                  <div
                    key={state.id}
                    className={`flex items-center gap-2 p-2 rounded transition-colors cursor-pointer ${
                      selectedNode === state.id
                        ? "bg-[#BD00FF]/20 border border-[#BD00FF]"
                        : "hover:bg-gray-700"
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
                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
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
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
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
      <div className="flex-1 relative bg-[#0A0A0B] min-h-0">
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
                // For transition nodes, select the transition instead of the node
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
            className="bg-[#0A0A0B]"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#333"
            />
            <Controls className="bg-[#27272A] border-gray-700 [&>button]:bg-[#27272A] [&>button]:border-gray-700 [&>button]:text-white [&>button:hover]:bg-gray-600" />
            {/* Position manager uses measured node dimensions to place transitions */}
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

      {/* Right Panel */}
      <div className="w-96 border-l border-gray-800 bg-[#27272A]/50 overflow-y-auto p-4">
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
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Select a state or transition</p>
              <p className="text-sm">to configure properties</p>
            </div>
          </div>
        )}
      </div>

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
