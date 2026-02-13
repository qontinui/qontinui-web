/**
 * Image Drag Hook
 *
 * Handles drag-and-drop operations for state images:
 * - Creating transitions by dragging images between states
 * - Moving images between states via Alt+drag
 */

import React, { useState, useCallback } from "react";
import type {
  State,
  Transition,
  OutgoingTransition,
  IncomingTransition,
} from "@/hooks/automation";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  createClickStateImageWorkflow,
  createFindStateWorkflow,
} from "@/lib/workflow-helpers";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseImageDrag");

interface UseImageDragOptions {
  states: State[];
  transitions: Transition[];
  workflows: Workflow[];
  addWorkflow: (workflow: Workflow) => void;
  updateWorkflow: (workflow: Workflow) => void;
  addTransition: (transition: Transition) => Promise<boolean>;
  updateTransition: (transition: Transition) => void;
  updateState: (state: State) => void;
}

export function useImageDrag({
  states,
  transitions,
  workflows,
  addWorkflow,
  updateWorkflow,
  addTransition,
  updateTransition,
  updateState,
}: UseImageDragOptions) {
  const [_imageDragData, setImageDragData] = useState<{
    sourceStateId: string;
    stateImageId: string;
  } | null>(null);

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

      // Check if transition already exists
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

      // Find existing "Click" workflow or create a new one
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
      } else {
        // Validate and fix the existing workflow's FIND action
        const findAction = clickWorkflow.actions.find((a) => a.type === "FIND");
        if (findAction) {
          const target = (
            findAction.config as {
              target?: { type?: string; imageIds?: string[] };
            }
          )?.target;
          if (target?.type === "stateImage" || target?.type !== "image") {
            const updatedActions = clickWorkflow.actions.map((action) => {
              if (action.type === "FIND") {
                return {
                  ...action,
                  config: {
                    ...action.config,
                    target: {
                      type: "image" as const,
                      imageIds: [stateImage.id],
                    },
                  },
                };
              }
              return action;
            });
            const updatedWorkflow = {
              ...clickWorkflow,
              actions: updatedActions,
            };
            updateWorkflow(updatedWorkflow);
            clickWorkflow = updatedWorkflow;
          }
        }
      }

      // Find existing "Find State" workflow or create a new one
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

      // Create the outgoing transition
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
    [
      states,
      transitions,
      workflows,
      addWorkflow,
      addTransition,
      updateTransition,
      updateWorkflow,
    ]
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

      if (targetStateId === sourceStateId) {
        toast.error("Cannot move to the same state");
        return;
      }

      const sourceState = states.find((s) => s.id === sourceStateId);
      const targetState = states.find((s) => s.id === targetStateId);
      if (!sourceState || !targetState) {
        toast.error("Could not find states");
        return;
      }

      const stateImageIndex = sourceState.stateImages?.findIndex(
        (img) => img.id === stateImageId
      );
      if (stateImageIndex === undefined || stateImageIndex === -1) {
        toast.error("Could not find state image");
        return;
      }

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
    event.dataTransfer.dropEffect = "link";
  }, []);

  // Handle drop on the canvas - determine which state node was targeted
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const dragDataStr = event.dataTransfer.getData(
        "application/stateimage-drag"
      );
      if (!dragDataStr) {
        return;
      }

      try {
        const dragData = JSON.parse(dragDataStr);

        let target = event.target as HTMLElement;
        let targetStateId: string | null = null;

        while (target && !targetStateId) {
          const nodeId = target.getAttribute("data-id");
          if (nodeId && states.some((s) => s.id === nodeId)) {
            targetStateId = nodeId;
            break;
          }
          target = target.parentElement as HTMLElement;
        }

        if (targetStateId) {
          if (dragData.isMoveOperation) {
            handleImageMoveToState(targetStateId, dragData);
          } else {
            handleImageDropOnState(targetStateId, dragData);
          }
        } else {
          setImageDragData(null);
        }
      } catch (e) {
        logger.error("Failed to parse drag data:", e);
        setImageDragData(null);
      }
    },
    [states, handleImageDropOnState, handleImageMoveToState]
  );

  return {
    handleStartImageDrag,
    handleImageDropOnState,
    handleImageMoveToState,
    handleDragOver,
    handleDrop,
  };
}
