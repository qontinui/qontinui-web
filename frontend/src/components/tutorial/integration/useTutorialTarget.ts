/**
 * useTutorialTarget - Hook for Marking Tutorial Targets
 *
 * Custom hook that marks elements as tutorial targets, automatically registers them,
 * and handles focus and scroll-into-view behavior.
 */

import { useEffect, useRef, useCallback } from "react";
import { useTutorial } from "./TutorialProvider";

// ============================================================================
// Types
// ============================================================================

interface TutorialTargetProps {
  ref: React.RefObject<HTMLElement>;
  "data-tutorial-id": string;
  className?: string;
  tabIndex?: number;
  "aria-label"?: string;
}

interface UseTutorialTargetOptions {
  /** Optional additional className to add */
  className?: string;
  /** Optional accessibility label */
  ariaLabel?: string;
  /** Whether element should be focusable */
  focusable?: boolean;
  /** Callback when target is focused by tutorial */
  onFocus?: () => void;
  /** Callback when target is unfocused */
  onBlur?: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to mark an element as a tutorial target
 *
 * @param targetId - Unique identifier for the tutorial target (data-tutorial-id)
 * @param options - Optional configuration
 * @returns Props to spread onto the target element
 *
 * @example
 * ```tsx
 * const AddActionButton = () => {
 *   const targetProps = useTutorialTarget('add-action-button', {
 *     ariaLabel: 'Add new action',
 *     focusable: true,
 *   });
 *
 *   return <button {...targetProps}>Add Action</button>;
 * };
 * ```
 */
export function useTutorialTarget(
  targetId: string,
  options: UseTutorialTargetOptions = {}
): TutorialTargetProps {
  const ref = useRef<HTMLElement>(null);
  const { registerTarget, unregisterTarget, currentStep, isActive, mode } =
    useTutorial();

  const {
    className = "",
    ariaLabel,
    focusable = false,
    onFocus,
    onBlur,
  } = options;

  // ============================================================================
  // Registration
  // ============================================================================

  useEffect(() => {
    if (ref.current) {
      registerTarget(targetId, ref.current);
    }

    return () => {
      unregisterTarget(targetId);
    };
  }, [targetId, registerTarget, unregisterTarget]);

  // ============================================================================
  // Focus Management
  // ============================================================================

  useEffect(() => {
    if (!ref.current || !isActive || mode !== "contextual") {
      return;
    }

    const targetSelector = `[data-tutorial-id="${targetId}"]`;
    const isCurrentTarget =
      currentStep?.targetElement?.selector === targetSelector;

    if (isCurrentTarget) {
      const element = ref.current;

      // Scroll into view if needed
      if (currentStep.targetElement?.scrollIntoView) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }

      // Apply focus highlight
      element.classList.add("tutorial-target-active");

      // Call onFocus callback
      onFocus?.();

      // Optional: Focus the element for keyboard accessibility
      if (focusable && element instanceof HTMLElement) {
        element.focus();
      }

      // Cleanup
      return () => {
        element.classList.remove("tutorial-target-active");
        onBlur?.();
      };
    }
  }, [targetId, currentStep, isActive, mode, focusable, onFocus, onBlur]);

  // ============================================================================
  // Pulse Animation for Attention
  // ============================================================================

  useEffect(() => {
    if (!ref.current || !isActive || mode !== "contextual") {
      return;
    }

    const targetSelector = `[data-tutorial-id="${targetId}"]`;
    const isCurrentTarget =
      currentStep?.targetElement?.selector === targetSelector;
    const highlightType = currentStep?.targetElement?.highlightType;

    if (isCurrentTarget && highlightType === "pulse") {
      const element = ref.current;
      element.classList.add("tutorial-target-pulse");

      return () => {
        element.classList.remove("tutorial-target-pulse");
      };
    }
  }, [targetId, currentStep, isActive, mode]);

  // ============================================================================
  // Build Props
  // ============================================================================

  const buildClassName = useCallback(() => {
    const classes = ["tutorial-target"];

    if (className) {
      classes.push(className);
    }

    // Add state classes
    if (isActive && mode === "contextual") {
      const targetSelector = `[data-tutorial-id="${targetId}"]`;
      const isCurrentTarget =
        currentStep?.targetElement?.selector === targetSelector;

      if (isCurrentTarget) {
        classes.push("tutorial-target-current");

        // Add highlight type class
        const highlightType = currentStep.targetElement?.highlightType;
        if (highlightType) {
          classes.push(`tutorial-target-${highlightType}`);
        }
      }
    }

    return classes.join(" ");
  }, [className, isActive, mode, targetId, currentStep]);

  // ============================================================================
  // Return Props
  // ============================================================================

  return {
    ref: ref as React.RefObject<HTMLElement>,
    "data-tutorial-id": targetId,
    className: buildClassName(),
    ...(focusable ? { tabIndex: 0 } : {}),
    ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
  };
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to check if a specific target is currently active in the tutorial
 *
 * @param targetId - The tutorial target ID to check
 * @returns Whether the target is currently active
 *
 * @example
 * ```tsx
 * const isActive = useIsTargetActive('add-action-button');
 * return <div>{isActive ? 'This button is being highlighted!' : ''}</div>;
 * ```
 */
export function useIsTargetActive(targetId: string): boolean {
  const { currentStep, isActive, mode } = useTutorial();

  if (!isActive || mode !== "contextual") {
    return false;
  }

  const targetSelector = `[data-tutorial-id="${targetId}"]`;
  return currentStep?.targetElement?.selector === targetSelector;
}

/**
 * Hook to programmatically scroll to a tutorial target
 *
 * @param targetId - The tutorial target ID to scroll to
 * @returns Function to trigger the scroll
 *
 * @example
 * ```tsx
 * const scrollToTarget = useScrollToTarget('settings-panel');
 * return <button onClick={scrollToTarget}>Show Settings</button>;
 * ```
 */
export function useScrollToTarget(targetId: string): () => void {
  const { getTarget } = useTutorial();

  return useCallback(() => {
    const element = getTarget(targetId);
    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }
  }, [targetId, getTarget]);
}

// ============================================================================
// Exports
// ============================================================================

export type { TutorialTargetProps, UseTutorialTargetOptions };
