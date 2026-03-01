import React from "react";
import type { Node, Edge } from "@xyflow/react";
import type {
  State,
  Transition,
  OutgoingTransition,
  IncomingTransition,
  ImageAsset,
} from "@/hooks/automation";
import { createLogger } from "@/lib/logger";

const logger = createLogger("StateStructure");

interface UseBuildNodesEdgesParams {
  states: State[];
  transitions: Transition[];
  images: ImageAsset[];
  isDraggingRef: React.MutableRefObject<boolean>;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  handleAddOutgoingTransition: (stateId: string) => void;
  handleStartImageDrag: (stateId: string, stateImageId: string) => void;
}

export function useBuildNodesEdges({
  states,
  transitions,
  images,
  isDraggingRef,
  setNodes,
  setEdges,
  handleAddOutgoingTransition,
  handleStartImageDrag,
}: UseBuildNodesEdgesParams) {
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

    const stateNodes: Node[] = states.map((s) => ({
      id: s.id,
      type: "stateNode",
      position: s.position,
      data: {
        state: { ...s },
        images,
        hasIncomingTransitions: incomingTransitionsByState.has(s.id),
        incomingTransitions: incomingTransitionsByState.get(s.id) || [],
        hasOutgoingTransitions: outgoingTransitionsByState.has(s.id),
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

          transitionNodes.push({
            id: transitionNodeId,
            type: "transitionNode",
            position: position,
            data: {
              transition,
              label: isMultiTarget ? `→ ${activateStates.length} states` : `→`,
              isSingleTarget: !isMultiTarget,
            },
          });

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
}
