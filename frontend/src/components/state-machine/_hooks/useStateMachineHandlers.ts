import React, { useCallback } from "react";
import type { Node, Edge, NodeChange, Connection } from "@xyflow/react";
import type { State, Transition, OutgoingTransition } from "@/hooks/automation";
import { StateUpdateCoordinator } from "@/contexts/automation-context/state-update-coordinator";
import { getLayoutedElements } from "@/lib/layout-utils";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";

const logger = createLogger("StateStructure");

interface UseStateMachineHandlersParams {
  states: State[];
  transitions: Transition[];
  nodes: Node[];
  edges: Edge[];
  selectedNode: string | null;
  isDraggingRef: React.MutableRefObject<boolean>;
  prevCountsRef: React.MutableRefObject<{
    stateCount: number;
    transitionCount: number;
  }>;
  onNodesChange: (changes: NodeChange[]) => void;
  setSelectedNode: (id: string | null) => void;
  setPreselectedOriginState: (id: string | null) => void;
  setOutgoingTransitionDialogOpen: (open: boolean) => void;
  addState: (state: State) => void;
  updateState: (state: State) => Promise<void> | void;
  deleteState: (stateId: string) => void;
  addTransition: (transition: Transition) => Promise<boolean>;
  updateTransition: (transition: Transition) => void;
}

export function useStateMachineHandlers({
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
}: UseStateMachineHandlersParams) {
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

  const handleAddOutgoingTransition = useCallback(
    (stateId: string) => {
      setPreselectedOriginState(stateId);
      setOutgoingTransitionDialogOpen(true);
    },
    [setPreselectedOriginState, setOutgoingTransitionDialogOpen]
  );

  const handleAddState = useCallback(() => {
    const position = findEmptyPosition();
    logger.info("[StateStructure] handleAddState - position:", position);
    const newState = StateUpdateCoordinator.createDefaultState(
      states,
      position
    );
    logger.info("[StateStructure] handleAddState - newState:", newState);
    addState(newState);
  }, [findEmptyPosition, states, addState]);

  const handleDeleteState = useCallback(
    (stateId: string) => {
      deleteState(stateId);
      if (selectedNode === stateId) setSelectedNode(null);
    },
    [deleteState, selectedNode, setSelectedNode]
  );

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

  return {
    handleNodesChange,
    handleAddOutgoingTransition,
    handleAddState,
    handleDeleteState,
    handleApplyMonitors,
    applyAutoLayout,
    onConnect,
  };
}
