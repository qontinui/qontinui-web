/**
 * TutorialTrigger - Component for Auto-Triggering Tutorials
 *
 * Monitors page load, user actions, and route changes to automatically
 * trigger tutorials based on configured conditions.
 */

import React, { useEffect, useRef, useCallback } from "react";
// TODO: This component uses react-router-dom but Next.js uses its own routing
// Replace with Next.js usePathname/useRouter
// import { useLocation } from "react-router-dom";
const useLocation = () => ({ pathname: "/" });
import { useTutorial } from "./TutorialProvider";
import { useTutorialStore } from "@/stores/tutorial-store";
import type { Tutorial } from "@/types/tutorial";

// ============================================================================
// Types
// ============================================================================

interface TutorialTriggerProps {
  /** Tutorials that can be auto-triggered */
  tutorials: Tutorial[];
  /** Whether to enable auto-triggering */
  enabled?: boolean;
  /** Delay before checking triggers (ms) */
  delay?: number;
}

interface TriggerHistory {
  [tutorialId: string]: {
    lastTriggered: number;
    triggerCount: number;
    dismissed: boolean;
  };
}

// ============================================================================
// Local Storage Keys
// ============================================================================

const TRIGGER_HISTORY_KEY = "qontinui-tutorial-trigger-history";
const DONT_SHOW_KEY = "qontinui-tutorial-dont-show";

// ============================================================================
// Component
// ============================================================================

export const TutorialTrigger: React.FC<TutorialTriggerProps> = ({
  tutorials,
  enabled = true,
  delay = 1000,
}) => {
  const location = useLocation();
  const { startTutorial } = useTutorial();
  const { dontShowTutorialsAgain, completedTutorials, inProgressTutorials } =
    useTutorialStore();

  const hasCheckedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // ============================================================================
  // Local Storage Helpers
  // ============================================================================

  const getTriggerHistory = useCallback((): TriggerHistory => {
    try {
      const stored = localStorage.getItem(TRIGGER_HISTORY_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("Failed to load trigger history:", error);
      return {};
    }
  }, []);

  const saveTriggerHistory = useCallback((history: TriggerHistory) => {
    try {
      localStorage.setItem(TRIGGER_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error("Failed to save trigger history:", error);
    }
  }, []);

  const getDontShowList = useCallback((): string[] => {
    try {
      const stored = localStorage.getItem(DONT_SHOW_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error("Failed to load dont show list:", error);
      return [];
    }
  }, []);

  // Helper function to add tutorial to "don't show again" list - currently unused
  /*
  const addToDontShow = useCallback(
    (tutorialId: string) => {
      try {
        const list = getDontShowList();
        if (!list.includes(tutorialId)) {
          list.push(tutorialId);
          localStorage.setItem(DONT_SHOW_KEY, JSON.stringify(list));
        }
      } catch (error) {
        console.error("Failed to save dont show preference:", error);
      }
    },
    [getDontShowList]
  );
  */

  // ============================================================================
  // Trigger Evaluation
  // ============================================================================

  const shouldTriggerTutorial = useCallback(
    (tutorial: Tutorial): boolean => {
      // Don't trigger if globally disabled
      if (!enabled || dontShowTutorialsAgain) {
        return false;
      }

      // Don't trigger if already completed
      if (completedTutorials.includes(tutorial.id)) {
        return false;
      }

      // Don't trigger if user has dismissed this tutorial
      const dontShowList = getDontShowList();
      if (dontShowList.includes(tutorial.id)) {
        return false;
      }

      // Don't trigger if currently in progress
      if (inProgressTutorials.includes(tutorial.id)) {
        return false;
      }

      // Check if triggers are configured
      if (!tutorial.triggers) {
        return false;
      }

      // Check automatic trigger
      if (tutorial.triggers.automatic) {
        const history = getTriggerHistory();
        const tutorialHistory = history[tutorial.id];

        // Only auto-trigger once per tutorial
        if (!tutorialHistory || tutorialHistory.triggerCount === 0) {
          return true;
        }
      }

      return false;
    },
    [
      enabled,
      dontShowTutorialsAgain,
      completedTutorials,
      inProgressTutorials,
      getDontShowList,
      getTriggerHistory,
    ]
  );

  const checkPageTriggers = useCallback(
    (tutorial: Tutorial): boolean => {
      // Check if tutorial is for current page
      if (
        tutorial.targetPage &&
        !location.pathname.includes(tutorial.targetPage)
      ) {
        return false;
      }

      return shouldTriggerTutorial(tutorial);
    },
    [location.pathname, shouldTriggerTutorial]
  );

  const evaluateContextualTriggers = useCallback(
    (tutorial: Tutorial): boolean => {
      if (!tutorial.triggers?.contextual) {
        return false;
      }

      // Evaluate each contextual trigger
      for (const trigger of tutorial.triggers.contextual) {
        try {
          // Create a safe evaluation function
          // Note: In production, use a safer evaluation method
          const conditionFunc = new Function("return " + trigger.condition);
          const result = conditionFunc();

          if (result) {
            return true;
          }
        } catch (error) {
          console.error(
            `Failed to evaluate trigger condition for ${tutorial.id}:`,
            error
          );
        }
      }

      return false;
    },
    []
  );

  // ============================================================================
  // Trigger Handler
  // ============================================================================

  const triggerTutorial = useCallback(
    (tutorial: Tutorial) => {
      // Record trigger in history
      const history = getTriggerHistory();
      const tutorialHistory = history[tutorial.id] || {
        lastTriggered: 0,
        triggerCount: 0,
        dismissed: false,
      };

      tutorialHistory.lastTriggered = Date.now();
      tutorialHistory.triggerCount += 1;

      history[tutorial.id] = tutorialHistory;
      saveTriggerHistory(history);

      // Start the tutorial
      startTutorial(tutorial);
    },
    [getTriggerHistory, saveTriggerHistory, startTutorial]
  );

  // ============================================================================
  // Check Triggers
  // ============================================================================

  const checkTriggers = useCallback(() => {
    if (!enabled || hasCheckedRef.current) {
      return;
    }

    // Find tutorials that should be triggered
    for (const tutorial of tutorials) {
      // Check page-based triggers
      if (checkPageTriggers(tutorial)) {
        hasCheckedRef.current = true;
        triggerTutorial(tutorial);
        return; // Only trigger one tutorial at a time
      }

      // Check contextual triggers
      if (
        shouldTriggerTutorial(tutorial) &&
        evaluateContextualTriggers(tutorial)
      ) {
        hasCheckedRef.current = true;
        triggerTutorial(tutorial);
        return; // Only trigger one tutorial at a time
      }
    }
  }, [
    enabled,
    tutorials,
    checkPageTriggers,
    shouldTriggerTutorial,
    evaluateContextualTriggers,
    triggerTutorial,
  ]);

  // ============================================================================
  // Effects
  // ============================================================================

  // Check triggers on mount and route change
  useEffect(() => {
    hasCheckedRef.current = false;

    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Delay trigger check to allow page to render
    timerRef.current = setTimeout(() => {
      checkTriggers();
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [location.pathname, checkTriggers, delay]);

  // Listen for custom tutorial trigger events
  useEffect(() => {
    const handleCustomTrigger = (
      event: CustomEvent<{ tutorialId: string }>
    ) => {
      const tutorial = tutorials.find((t) => t.id === event.detail.tutorialId);

      if (tutorial && shouldTriggerTutorial(tutorial)) {
        triggerTutorial(tutorial);
      }
    };

    window.addEventListener(
      "trigger-tutorial" as any,
      handleCustomTrigger as EventListener
    );

    return () => {
      window.removeEventListener(
        "trigger-tutorial" as any,
        handleCustomTrigger as EventListener
      );
    };
  }, [tutorials, shouldTriggerTutorial, triggerTutorial]);

  // ============================================================================
  // Render
  // ============================================================================

  // This is a logic-only component, no UI
  return null;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Programmatically trigger a tutorial by ID
 *
 * @param tutorialId - ID of the tutorial to trigger
 *
 * @example
 * ```tsx
 * import { triggerTutorialById } from './TutorialTrigger';
 *
 * const handleHelpClick = () => {
 *   triggerTutorialById('getting-started');
 * };
 * ```
 */
export function triggerTutorialById(tutorialId: string): void {
  const event = new CustomEvent("trigger-tutorial", {
    detail: { tutorialId },
  });
  window.dispatchEvent(event);
}

/**
 * Mark a tutorial as "don't show again"
 *
 * @param tutorialId - ID of the tutorial to dismiss
 *
 * @example
 * ```tsx
 * import { dismissTutorial } from './TutorialTrigger';
 *
 * const handleDismiss = () => {
 *   dismissTutorial('getting-started');
 * };
 * ```
 */
export function dismissTutorial(tutorialId: string): void {
  try {
    const stored = localStorage.getItem(DONT_SHOW_KEY);
    const list: string[] = stored ? JSON.parse(stored) : [];

    if (!list.includes(tutorialId)) {
      list.push(tutorialId);
      localStorage.setItem(DONT_SHOW_KEY, JSON.stringify(list));
    }
  } catch (error) {
    console.error("Failed to dismiss tutorial:", error);
  }
}

/**
 * Reset all tutorial trigger history
 *
 * @example
 * ```tsx
 * import { resetTriggerHistory } from './TutorialTrigger';
 *
 * const handleReset = () => {
 *   resetTriggerHistory();
 * };
 * ```
 */
export function resetTriggerHistory(): void {
  try {
    localStorage.removeItem(TRIGGER_HISTORY_KEY);
    localStorage.removeItem(DONT_SHOW_KEY);
  } catch (error) {
    console.error("Failed to reset trigger history:", error);
  }
}

// ============================================================================
// Exports
// ============================================================================

export type { TutorialTriggerProps, TriggerHistory };
