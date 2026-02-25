/**
 * Transition Position Manager
 *
 * Helper component that calculates transition node positions using measured
 * node dimensions from ReactFlow. Must be rendered inside a ReactFlow provider.
 */

"use client";

import React from "react";
import { useReactFlow } from "@xyflow/react";
import type { State, OutgoingTransition, Transition } from "@/hooks/automation";

interface TransitionPositionManagerProps {
  transitions: OutgoingTransition[];
  states: State[];
  updateTransition: (transition: Transition) => void;
}

export function TransitionPositionManager({
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
