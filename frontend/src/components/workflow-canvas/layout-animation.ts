/**
 * Layout Animation - Smooth transitions for layout changes
 *
 * This module provides utilities for animating node position changes
 * when applying new layouts, with support for:
 * - Smooth easing functions
 * - Cancellable animations
 * - Progress callbacks
 * - Multiple easing curves
 */

import type { Workflow, Action } from "@/lib/action-schema/action-types";
import { useState, useCallback, useRef, useEffect } from "react";

// ============================================================================
// Types
// ============================================================================

export type EasingFunction = (t: number) => number;

export type EasingType =
  | "linear"
  | "easeInOut"
  | "easeOut"
  | "easeIn"
  | "easeInOutCubic"
  | "spring";

export interface AnimationOptions {
  /** Animation duration in milliseconds */
  duration?: number;

  /** Easing function type */
  easing?: EasingType;

  /** Callback for each frame */
  onProgress?: (progress: number) => void;

  /** Callback when animation completes */
  onComplete?: () => void;

  /** Callback if animation is cancelled */
  onCancel?: () => void;
}

export interface PositionMap {
  [actionId: string]: [number, number];
}

export interface AnimationState {
  isAnimating: boolean;
  progress: number;
  startTime: number;
  endTime: number;
}

// ============================================================================
// Easing Functions
// ============================================================================

export const EASING_FUNCTIONS: Record<EasingType, EasingFunction> = {
  linear: (t: number) => t,

  easeInOut: (t: number) => {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  },

  easeOut: (t: number) => {
    return t * (2 - t);
  },

  easeIn: (t: number) => {
    return t * t;
  },

  easeInOutCubic: (t: number) => {
    return t < 0.5 ? 4 * t * t * t : 1 + --t * (2 * t) * (2 * t);
  },

  spring: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : -Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

// ============================================================================
// Animation Controller
// ============================================================================

export class LayoutAnimationController {
  private animationFrameId: number | null = null;
  private cancelledCallbacks: (() => void)[] = [];

  /**
   * Animate node positions from one layout to another
   */
  animate(
    fromPositions: PositionMap,
    toPositions: PositionMap,
    onUpdate: (currentPositions: PositionMap) => void,
    options: AnimationOptions = {}
  ): Promise<void> {
    const {
      duration = 500,
      easing = "easeInOutCubic",
      onProgress,
      onComplete,
      onCancel,
    } = options;

    // Cancel any existing animation
    this.cancel();

    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const endTime = startTime + duration;
      const easingFn = EASING_FUNCTIONS[easing];

      // Store cancel callback
      if (onCancel) {
        this.cancelledCallbacks.push(onCancel);
      }

      const animate = (currentTime: number) => {
        // Check if cancelled
        if (this.animationFrameId === null) {
          this.cancelledCallbacks.forEach((cb) => cb());
          this.cancelledCallbacks = [];
          reject(new Error("Animation cancelled"));
          return;
        }

        // Calculate progress
        const elapsed = currentTime - startTime;
        const rawProgress = Math.min(elapsed / duration, 1);
        const easedProgress = easingFn(rawProgress);

        // Interpolate positions
        const currentPositions: PositionMap = {};

        for (const actionId in toPositions) {
          const from = fromPositions[actionId] || toPositions[actionId];
          const to = toPositions[actionId];
          if (!from || !to) continue;

          currentPositions[actionId] = [
            from[0] + (to[0] - from[0]) * easedProgress,
            from[1] + (to[1] - from[1]) * easedProgress,
          ];
        }

        // Update positions
        onUpdate(currentPositions);

        // Call progress callback
        if (onProgress) {
          onProgress(rawProgress);
        }

        // Continue or complete
        if (rawProgress < 1) {
          this.animationFrameId = requestAnimationFrame(animate);
        } else {
          this.animationFrameId = null;
          this.cancelledCallbacks = [];
          if (onComplete) {
            onComplete();
          }
          resolve();
        }
      };

      // Start animation
      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Cancel the current animation
   */
  cancel(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Check if animation is running
   */
  isAnimating(): boolean {
    return this.animationFrameId !== null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract position map from workflow
 */
export function extractPositions(workflow: Workflow): PositionMap {
  const positions: PositionMap = {};

  for (const action of workflow.actions) {
    if (action.position) {
      positions[action.id] = [...action.position];
    }
  }

  return positions;
}

/**
 * Apply position map to workflow (mutates workflow)
 */
export function applyPositions(
  workflow: Workflow,
  positions: PositionMap
): void {
  for (const action of workflow.actions) {
    const position = positions[action.id];
    if (position) {
      action.position = position;
    }
  }
}

/**
 * Create a position map with all nodes at a specific position
 */
export function createUniformPositions(
  actionIds: string[],
  position: [number, number]
): PositionMap {
  const positions: PositionMap = {};

  for (const id of actionIds) {
    positions[id] = [...position];
  }

  return positions;
}

/**
 * Calculate bounding box of positions
 */
export function calculateBoundingBox(positions: PositionMap): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of Object.values(positions)) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

// ============================================================================
// React Hook
// ============================================================================

export interface UseLayoutAnimationResult {
  /** Whether animation is currently running */
  isAnimating: boolean;

  /** Current animation progress (0-1) */
  progress: number;

  /** Animate from one workflow layout to another */
  animate: (
    workflow: Workflow,
    fromLayout: Workflow,
    toLayout: Workflow,
    options?: AnimationOptions
  ) => Promise<void>;

  /** Cancel current animation */
  cancel: () => void;
}

/**
 * React hook for layout animations
 */
export function useLayoutAnimation(): UseLayoutAnimationResult {
  const [isAnimating, setIsAnimating] = useState(false);
  const [progress, setProgress] = useState(0);
  const controllerRef = useRef<LayoutAnimationController | null>(null);

  // Initialize controller
  useEffect(() => {
    controllerRef.current = new LayoutAnimationController();

    return () => {
      controllerRef.current?.cancel();
    };
  }, []);

  const animate = useCallback(
    async (
      workflow: Workflow,
      fromLayout: Workflow,
      toLayout: Workflow,
      options: AnimationOptions = {}
    ): Promise<void> => {
      if (!controllerRef.current) return;

      const fromPositions = extractPositions(fromLayout);
      const toPositions = extractPositions(toLayout);

      setIsAnimating(true);
      setProgress(0);

      try {
        await controllerRef.current.animate(
          fromPositions,
          toPositions,
          (currentPositions) => {
            applyPositions(workflow, currentPositions);
          },
          {
            ...options,
            onProgress: (p) => {
              setProgress(p);
              options.onProgress?.(p);
            },
            onComplete: () => {
              setIsAnimating(false);
              setProgress(1);
              options.onComplete?.();
            },
            onCancel: () => {
              setIsAnimating(false);
              setProgress(0);
              options.onCancel?.();
            },
          }
        );
      } catch (error) {
        setIsAnimating(false);
        setProgress(0);
      }
    },
    []
  );

  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setIsAnimating(false);
    setProgress(0);
  }, []);

  return {
    isAnimating,
    progress,
    animate,
    cancel,
  };
}

/**
 * Animate a single action's position
 */
export async function animateAction(
  action: Action,
  toPosition: [number, number],
  duration: number = 300,
  easing: EasingType = "easeOut"
): Promise<void> {
  const controller = new LayoutAnimationController();
  const fromPosition = action.position ? [...action.position] : toPosition;

  await controller.animate(
    { [action.id]: fromPosition as [number, number] },
    { [action.id]: toPosition },
    (positions) => {
      action.position = positions[action.id];
    },
    { duration, easing }
  );
}

/**
 * Animate multiple actions
 */
export async function animateActions(
  actions: Action[],
  toPositions: PositionMap,
  duration: number = 300,
  easing: EasingType = "easeOut"
): Promise<void> {
  const controller = new LayoutAnimationController();
  const fromPositions: PositionMap = {};

  for (const action of actions) {
    fromPositions[action.id] = action.position
      ? [...action.position]
      : toPositions[action.id];
  }

  await controller.animate(
    fromPositions,
    toPositions,
    (currentPositions) => {
      for (const action of actions) {
        const pos = currentPositions[action.id];
        if (pos) {
          action.position = pos;
        }
      }
    },
    { duration, easing }
  );
}

/**
 * Staggered animation - animate nodes one after another
 */
export async function animateStaggered(
  actions: Action[],
  toPositions: PositionMap,
  options: {
    duration?: number;
    staggerDelay?: number;
    easing?: EasingType;
  } = {}
): Promise<void> {
  const { duration = 300, staggerDelay = 50, easing = "easeOut" } = options;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const toPosition = toPositions[action.id];

    if (!toPosition) continue;

    // Start animation
    animateAction(action, toPosition, duration, easing);

    // Wait for stagger delay
    if (i < actions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, staggerDelay));
    }
  }
}

/**
 * Zoom animation effect
 */
export function createZoomAnimation(
  scale: { from: number; to: number },
  duration: number = 300,
  easing: EasingType = "easeOut"
): (progress: number) => number {
  const easingFn = EASING_FUNCTIONS[easing];

  return (t: number) => {
    const easedT = easingFn(t);
    return scale.from + (scale.to - scale.from) * easedT;
  };
}

/**
 * Fade animation effect
 */
export function createFadeAnimation(
  opacity: { from: number; to: number },
  duration: number = 300,
  easing: EasingType = "linear"
): (progress: number) => number {
  const easingFn = EASING_FUNCTIONS[easing];

  return (t: number) => {
    const easedT = easingFn(t);
    return opacity.from + (opacity.to - opacity.from) * easedT;
  };
}
