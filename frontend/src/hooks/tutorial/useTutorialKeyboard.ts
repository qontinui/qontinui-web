/**
 * Tutorial Keyboard Navigation Hook
 *
 * Provides keyboard shortcuts for navigating through tutorials.
 */

import { useCallback, useEffect } from "react";

export interface TutorialKeyboardOptions {
  /** Callback for next step */
  onNext?: () => void;
  /** Callback for previous step */
  onPrevious?: () => void;
  /** Callback for closing the tutorial */
  onClose?: () => void;
  /** Callback for completing the tutorial (on last step) */
  onComplete?: () => void;
  /** Whether keyboard navigation is enabled */
  enabled?: boolean;
  /** Whether currently on the first step */
  isFirstStep?: boolean;
  /** Whether currently on the last step */
  isLastStep?: boolean;
  /** Whether currently waiting for an event (disable navigation) */
  isWaiting?: boolean;
}

/**
 * Hook for keyboard navigation in tutorials
 *
 * Keyboard shortcuts:
 * - ArrowRight / ArrowDown: Next step
 * - ArrowLeft / ArrowUp: Previous step
 * - Escape: Close tutorial
 * - Enter: Complete tutorial (on last step)
 *
 * Navigation is disabled when:
 * - Typing in an input or textarea
 * - Editing contentEditable elements
 * - Waiting for an event (isWaiting = true)
 */
export function useTutorialKeyboard(options: TutorialKeyboardOptions): void {
  const {
    onNext,
    onPrevious,
    onClose,
    onComplete,
    enabled = true,
    isFirstStep = false,
    isLastStep = false,
    isWaiting = false,
  } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't handle if disabled or waiting
      if (!enabled || isWaiting) {
        return;
      }

      // Don't handle if user is typing
      const target = event.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          if (isLastStep) {
            // On last step, complete instead of next
            onComplete?.();
          } else {
            onNext?.();
          }
          event.preventDefault();
          break;

        case "ArrowLeft":
        case "ArrowUp":
          if (!isFirstStep) {
            onPrevious?.();
          }
          event.preventDefault();
          break;

        case "Escape":
          onClose?.();
          event.preventDefault();
          break;

        case "Enter":
          if (isLastStep) {
            onComplete?.();
            event.preventDefault();
          }
          break;
      }
    },
    [
      enabled,
      isWaiting,
      isFirstStep,
      isLastStep,
      onNext,
      onPrevious,
      onClose,
      onComplete,
    ]
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

/**
 * Get keyboard shortcut display strings
 */
export function getKeyboardShortcuts(): { key: string; description: string }[] {
  return [
    { key: "→ or ↓", description: "Next step" },
    { key: "← or ↑", description: "Previous step" },
    { key: "Esc", description: "Close tutorial" },
    { key: "Enter", description: "Complete (on last step)" },
  ];
}
