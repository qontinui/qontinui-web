import React, { useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import { useStates, useTransitions, useImages } from "@/hooks/automation";
import { useAutomation } from "@/contexts/automation-context";
import { useStatesBridge } from "@/stores/page-state";
import { createLogger } from "@/lib/logger";

const logger = createLogger("StateStructure");

export function useStateMachineState() {
  const { states } = useStates();

  React.useEffect(() => {
    logger.info("[StateStructure] Component mounted/states changed:", {
      statesCount: states.length,
      stateIds: states.map((s) => s.id),
      stateNames: states.map((s) => s.name),
    });
  }, [states]);

  const { transitions } = useTransitions();

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

  const pendingIdChangeRef = useRef<{ oldId: string; newId: string } | null>(
    null
  );
  const prevCountsRef = useRef({ stateCount: 0, transitionCount: 0 });
  const isDraggingRef = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

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

  return {
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
  };
}
