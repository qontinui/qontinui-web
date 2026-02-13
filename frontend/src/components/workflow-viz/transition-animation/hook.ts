/**
 * Transition Animation Hook
 *
 * React hook for transition animation control.
 * Wraps the TransitionAnimationController class in a reactive hook interface.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  TransitionAnimationState,
  TransitionVisualizationData,
  ActionAnimationConfig,
  INITIAL_ANIMATION_STATE,
} from "@/types/transition-animation";
import type { Transition, State } from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { Monitor } from "@/lib/schemas/geometry";
import { TransitionAnimationController } from "./controller";
import { createLogger } from "@/lib/logger";
const logger = createLogger("Hook");

export interface UseTransitionAnimationResult {
  /** Current animation state */
  state: TransitionAnimationState;

  /** Current visualization data */
  data: TransitionVisualizationData | null;

  /** Currently animating action */
  currentAction: ActionAnimationConfig | null;

  /** Load a transition for visualization */
  loadTransition: (
    transition: Transition,
    states: State[],
    workflows: Workflow[],
    monitors?: Monitor[]
  ) => void;

  /** Playback controls */
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  seekTo: (actionIndex: number) => void;
  cancel: () => void;
}

/**
 * React hook for transition animation control
 */
export function useTransitionAnimation(): UseTransitionAnimationResult {
  const [state, setState] = useState<TransitionAnimationState>(
    INITIAL_ANIMATION_STATE
  );
  // Store data in state so it's reactive
  const [data, setData] = useState<TransitionVisualizationData | null>(null);
  const controllerRef = useRef<TransitionAnimationController | null>(null);

  useEffect(() => {
    // Create controller with a callback that updates both state and data
    controllerRef.current = new TransitionAnimationController((newState) => {
      if (process.env.NODE_ENV === "development") {
        // Log state changes (but not every progress update - only phase/action changes)
        const prevPhase = controllerRef.current?.getState().phase;
        if (
          newState.phase !== prevPhase ||
          newState.globalActionIndex !==
            controllerRef.current?.getState().globalActionIndex
        ) {
          logger.info("[TransitionAnimation] Hook setState:", {
            phase: newState.phase,
            progress: newState.progress.toFixed(3),
            globalActionIndex: newState.globalActionIndex,
            isPlaying: newState.isPlaying,
          });
        }
      }
      setState(newState);
      // Also sync data from controller when state changes
      setData(controllerRef.current?.getData() || null);
    });

    return () => {
      controllerRef.current?.cancel();
    };
  }, []);

  const loadTransition = useCallback(
    (
      transition: Transition,
      states: State[],
      workflows: Workflow[],
      monitors?: Monitor[]
    ) => {
      controllerRef.current?.loadTransition(
        transition,
        states,
        workflows,
        monitors
      );
      // Immediately sync data after loading
      setData(controllerRef.current?.getData() || null);
    },
    []
  );

  const play = useCallback(() => controllerRef.current?.play(), []);
  const pause = useCallback(() => controllerRef.current?.pause(), []);
  const stepForward = useCallback(
    () => controllerRef.current?.stepForward(),
    []
  );
  const stepBackward = useCallback(
    () => controllerRef.current?.stepBackward(),
    []
  );
  const reset = useCallback(() => controllerRef.current?.reset(), []);
  const setSpeed = useCallback(
    (speed: number) => controllerRef.current?.setSpeed(speed),
    []
  );
  const seekTo = useCallback(
    (index: number) => controllerRef.current?.seekTo(index),
    []
  );
  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setData(null);
  }, []);

  // Derive currentAction from state and data (reactive)
  const currentAction = useMemo(() => {
    if (!data || state.phase !== "executing-action") return null;
    return data.actionSequence[state.globalActionIndex] || null;
  }, [data, state.phase, state.globalActionIndex]);

  return {
    state,
    data,
    currentAction,
    loadTransition,
    play,
    pause,
    stepForward,
    stepBackward,
    reset,
    setSpeed,
    seekTo,
    cancel,
  };
}
