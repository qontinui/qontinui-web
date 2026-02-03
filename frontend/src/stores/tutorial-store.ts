/**
 * Tutorial Store
 *
 * Manages interactive tutorial state and progress through tutorial steps.
 * Supports both overlay and contextual tutorial modes.
 * Persists to localStorage to track completion across sessions.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tutorial, TutorialStep, TutorialMode } from "@/types/tutorial";

// ============================================================================
// Types
// ============================================================================

/**
 * Re-export types from tutorial.ts for convenience
 */
export type { Tutorial, TutorialStep, TutorialMode };

/**
 * Validation state for interactive tutorial steps
 */
export interface ValidationState {
  /** Whether validation is currently in progress */
  isValidating: boolean;
  /** Whether the current step validation passed */
  isValid: boolean;
  /** Feedback message to show to the user */
  feedback: string;
}

/**
 * Tooltip position coordinates
 */
export interface TooltipPosition {
  /** X coordinate in pixels */
  x: number;
  /** Y coordinate in pixels */
  y: number;
}

/**
 * Validation attempt record
 */
export interface ValidationAttempt {
  /** Step ID */
  stepId: string;
  /** Timestamp of attempt */
  timestamp: number;
  /** Whether attempt was successful */
  success: boolean;
}

/**
 * Tutorial trigger record
 */
export interface TriggerRecord {
  /** Tutorial ID */
  tutorialId: string;
  /** Timestamp when trigger was shown */
  timestamp: number;
  /** Number of times shown */
  count: number;
}

export interface TutorialState {
  // ========================================================================
  // Core Tutorial State (Overlay Mode)
  // ========================================================================

  /** Currently active tutorial */
  currentTutorial: Tutorial | null;
  /** Current step index (0-indexed) */
  currentStepIndex: number;
  /** Whether the tutorial dialog is open */
  isOpen: boolean;
  /** Tutorial history - which tutorials have been completed */
  completedTutorials: string[];
  /** User preference to not show tutorials again */
  dontShowTutorialsAgain: boolean;
  /** Tutorials in progress (user started but didn't complete) */
  inProgressTutorials: string[];

  // ========================================================================
  // Contextual Tutorial State
  // ========================================================================

  /** Current tutorial display mode */
  currentMode: TutorialMode | null;
  /** Reference to currently highlighted element (not persisted) */
  targetElement: HTMLElement | null;
  /** Tooltip position coordinates */
  tooltipPosition: TooltipPosition | null;
  /** Current validation state for interactive steps */
  validationState: ValidationState | null;
  /** Whether the contextual tutorial panel is collapsed */
  contextualPanelCollapsed: boolean;

  // ========================================================================
  // Validation & Trigger Tracking (Persisted)
  // ========================================================================

  /** History of validation attempts */
  validationAttempts: ValidationAttempt[];
  /** History of tutorial triggers shown */
  triggerHistory: TriggerRecord[];
}

export interface TutorialActions {
  // ========================================================================
  // Core Tutorial Actions (Overlay Mode)
  // ========================================================================

  /**
   * Open a tutorial dialog
   */
  openTutorial: (tutorial: Tutorial, mode?: TutorialMode) => void;

  /**
   * Close the tutorial dialog
   */
  closeTutorial: () => void;

  /**
   * Move to the next step (with optional validation)
   */
  nextStep: () => Promise<void>;

  /**
   * Move to the previous step
   */
  previousStep: () => void;

  /**
   * Jump to a specific step
   */
  goToStep: (stepIndex: number) => void;

  /**
   * Complete the current tutorial
   */
  completeTutorial: () => void;

  /**
   * Skip the current tutorial
   */
  skipTutorial: () => void;

  /**
   * Mark a tutorial as in progress
   */
  markInProgress: (tutorialId: string) => void;

  /**
   * Mark a tutorial as completed (without running through it)
   */
  markTutorialCompleted: (tutorialId: string) => void;

  /**
   * Get the current step
   */
  getCurrentStep: () => TutorialStep | null;

  /**
   * Check if on the last step
   */
  isLastStep: () => boolean;

  /**
   * Check if on the first step
   */
  isFirstStep: () => boolean;

  /**
   * Get completion percentage
   */
  getCompletionPercentage: () => number;

  /**
   * Check if a tutorial has been completed
   */
  isTutorialCompleted: (tutorialId: string) => boolean;

  /**
   * Set preference to not show tutorials
   */
  setDontShowTutorials: (value: boolean) => void;

  /**
   * Reset all tutorial state
   */
  resetTutorials: () => void;

  // ========================================================================
  // Contextual Tutorial Actions
  // ========================================================================

  /**
   * Set the current tutorial mode
   */
  setMode: (mode: TutorialMode | null) => void;

  /**
   * Set the target element for highlighting
   */
  setTargetElement: (element: HTMLElement | null) => void;

  /**
   * Update the validation state
   */
  updateValidation: (state: ValidationState | null) => void;

  /**
   * Toggle the contextual tutorial panel collapsed state
   */
  toggleContextualPanel: () => void;

  /**
   * Highlight an element by selector
   */
  highlightElement: (selector: string) => boolean;

  /**
   * Clear the current highlight
   */
  clearHighlight: () => void;

  // ========================================================================
  // Validation Methods
  // ========================================================================

  /**
   * Validate the current step
   */
  validateStep: (stepId: string, context?: unknown) => Promise<boolean>;

  /**
   * Record a validation attempt
   */
  recordValidationAttempt: (stepId: string, success: boolean) => void;

  // ========================================================================
  // Tutorial Trigger Methods
  // ========================================================================

  /**
   * Check if any tutorial should be triggered for the current context
   */
  checkTriggers: (page: string, context?: unknown) => Tutorial | null;

  /**
   * Record that a trigger was shown
   */
  recordTriggerShown: (tutorialId: string) => void;

  /**
   * Check if a trigger should be shown
   */
  shouldShowTrigger: (tutorialId: string) => boolean;
}

export type TutorialStore = TutorialState & TutorialActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: TutorialState = {
  // Core state
  currentTutorial: null,
  currentStepIndex: 0,
  isOpen: false,
  completedTutorials: [],
  dontShowTutorialsAgain: false,
  inProgressTutorials: [],

  // Contextual tutorial state
  currentMode: null,
  targetElement: null,
  tooltipPosition: null,
  validationState: null,
  contextualPanelCollapsed: false,

  // Validation & trigger tracking
  validationAttempts: [],
  triggerHistory: [],
};

// ============================================================================
// Store
// ============================================================================

export const useTutorialStore = create<TutorialStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ========================================================================
      // Dialog Management
      // ========================================================================

      openTutorial: (tutorial: Tutorial, mode?: TutorialMode) => {
        // Determine mode: use provided mode, or tutorial's default mode, or 'overlay'
        const tutorialMode = mode || tutorial.mode || "overlay";

        set({
          currentTutorial: tutorial,
          currentStepIndex: 0,
          isOpen: true,
          currentMode: tutorialMode,
        });
        get().markInProgress(tutorial.id);

        // If contextual mode, try to highlight the first step's target element
        if (tutorialMode === "contextual" || tutorialMode === "hybrid") {
          const firstStep = tutorial.steps[0];
          if (firstStep?.targetElement?.selector) {
            get().highlightElement(firstStep.targetElement.selector);
          }
        }
      },

      closeTutorial: () => {
        // Clean up highlighted elements
        get().clearHighlight();

        set({
          isOpen: false,
          currentMode: null,
          targetElement: null,
          tooltipPosition: null,
          validationState: null,
        });
      },

      // ========================================================================
      // Navigation
      // ========================================================================

      nextStep: async () => {
        const { currentTutorial, currentStepIndex, currentMode } = get();
        if (!currentTutorial) return;

        const currentStep = currentTutorial.steps[currentStepIndex];

        // Check if validation is required for this step
        if (currentStep?.validation && !currentStep.validation.optional) {
          const isValid = await get().validateStep(currentStep.id);
          if (!isValid) {
            // Validation failed, don't advance
            return;
          }
        }

        // Clear current highlight before moving to next step
        get().clearHighlight();

        const maxSteps = currentTutorial.steps.length;
        if (currentStepIndex < maxSteps - 1) {
          const nextStepIndex = currentStepIndex + 1;
          set({ currentStepIndex: nextStepIndex, validationState: null });

          // If contextual mode, highlight the next step's target element
          if (currentMode === "contextual" || currentMode === "hybrid") {
            const nextStep = currentTutorial.steps[nextStepIndex];
            if (nextStep?.targetElement?.selector) {
              get().highlightElement(nextStep.targetElement.selector);
            }
          }
        } else {
          // Auto-complete when reaching the end
          get().completeTutorial();
        }
      },

      previousStep: () => {
        const { currentStepIndex, currentTutorial, currentMode } = get();
        if (currentStepIndex > 0) {
          // Clear current highlight
          get().clearHighlight();

          const prevStepIndex = currentStepIndex - 1;
          set({ currentStepIndex: prevStepIndex, validationState: null });

          // If contextual mode, highlight the previous step's target element
          if (
            currentTutorial &&
            (currentMode === "contextual" || currentMode === "hybrid")
          ) {
            const prevStep = currentTutorial.steps[prevStepIndex];
            if (prevStep?.targetElement?.selector) {
              get().highlightElement(prevStep.targetElement.selector);
            }
          }
        }
      },

      goToStep: (stepIndex: number) => {
        const { currentTutorial, currentMode } = get();
        if (!currentTutorial) return;

        // Clear current highlight
        get().clearHighlight();

        const clampedIndex = Math.max(
          0,
          Math.min(stepIndex, currentTutorial.steps.length - 1)
        );
        set({ currentStepIndex: clampedIndex, validationState: null });

        // If contextual mode, highlight the target step's element
        if (currentMode === "contextual" || currentMode === "hybrid") {
          const targetStep = currentTutorial.steps[clampedIndex];
          if (targetStep?.targetElement?.selector) {
            get().highlightElement(targetStep.targetElement.selector);
          }
        }
      },

      // ========================================================================
      // Completion & Progress
      // ========================================================================

      completeTutorial: () => {
        const { currentTutorial, completedTutorials, inProgressTutorials } =
          get();
        if (!currentTutorial) return;

        // Clean up highlights
        get().clearHighlight();

        const updated = new Set(completedTutorials);
        updated.add(currentTutorial.id);

        const inProgress = new Set(inProgressTutorials);
        inProgress.delete(currentTutorial.id);

        set({
          completedTutorials: Array.from(updated),
          inProgressTutorials: Array.from(inProgress),
          isOpen: false,
          currentTutorial: null,
          currentStepIndex: 0,
          currentMode: null,
          targetElement: null,
          tooltipPosition: null,
          validationState: null,
        });
      },

      skipTutorial: () => {
        const { currentTutorial, inProgressTutorials } = get();
        if (!currentTutorial) return;

        // Clean up highlights
        get().clearHighlight();

        const inProgress = new Set(inProgressTutorials);
        inProgress.delete(currentTutorial.id);

        set({
          inProgressTutorials: Array.from(inProgress),
          isOpen: false,
          currentTutorial: null,
          currentStepIndex: 0,
          currentMode: null,
          targetElement: null,
          tooltipPosition: null,
          validationState: null,
        });
      },

      markInProgress: (tutorialId: string) => {
        const { inProgressTutorials } = get();
        if (!inProgressTutorials.includes(tutorialId)) {
          set({
            inProgressTutorials: [...inProgressTutorials, tutorialId],
          });
        }
      },

      markTutorialCompleted: (tutorialId: string) => {
        const { completedTutorials, inProgressTutorials } = get();
        if (!completedTutorials.includes(tutorialId)) {
          const updated = new Set(completedTutorials);
          updated.add(tutorialId);

          const inProgress = new Set(inProgressTutorials);
          inProgress.delete(tutorialId);

          set({
            completedTutorials: Array.from(updated),
            inProgressTutorials: Array.from(inProgress),
          });
        }
      },

      // ========================================================================
      // State Queries
      // ========================================================================

      getCurrentStep: (): TutorialStep | null => {
        const { currentTutorial, currentStepIndex } = get();
        if (!currentTutorial) return null;
        return currentTutorial.steps[currentStepIndex] ?? null;
      },

      isLastStep: (): boolean => {
        const { currentTutorial, currentStepIndex } = get();
        if (!currentTutorial) return false;
        return currentStepIndex === currentTutorial.steps.length - 1;
      },

      isFirstStep: (): boolean => {
        return get().currentStepIndex === 0;
      },

      getCompletionPercentage: (): number => {
        const { currentTutorial, currentStepIndex } = get();
        if (!currentTutorial || currentTutorial.steps.length === 0) return 0;
        return Math.round(
          ((currentStepIndex + 1) / currentTutorial.steps.length) * 100
        );
      },

      isTutorialCompleted: (tutorialId: string): boolean => {
        return get().completedTutorials.includes(tutorialId);
      },

      // ========================================================================
      // Preferences
      // ========================================================================

      setDontShowTutorials: (value: boolean) => {
        set({ dontShowTutorialsAgain: value });
      },

      // ========================================================================
      // Reset
      // ========================================================================

      resetTutorials: () => {
        get().clearHighlight();
        set(initialState);
      },

      // ========================================================================
      // Contextual Tutorial Actions
      // ========================================================================

      setMode: (mode: TutorialMode | null) => {
        set({ currentMode: mode });
      },

      setTargetElement: (element: HTMLElement | null) => {
        set({ targetElement: element });

        // Update tooltip position if element is provided
        if (element) {
          const rect = element.getBoundingClientRect();
          set({
            tooltipPosition: {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            },
          });
        } else {
          set({ tooltipPosition: null });
        }
      },

      updateValidation: (state: ValidationState | null) => {
        set({ validationState: state });
      },

      toggleContextualPanel: () => {
        set((state) => ({
          contextualPanelCollapsed: !state.contextualPanelCollapsed,
        }));
      },

      highlightElement: (selector: string): boolean => {
        try {
          const element = document.querySelector<HTMLElement>(selector);
          if (element) {
            get().setTargetElement(element);

            // Scroll element into view if needed
            const currentStep = get().getCurrentStep();
            if (currentStep?.targetElement?.scrollIntoView !== false) {
              element.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center",
              });
            }

            return true;
          }
          return false;
        } catch (error) {
          console.error("Failed to highlight element:", error);
          return false;
        }
      },

      clearHighlight: () => {
        set({
          targetElement: null,
          tooltipPosition: null,
        });
      },

      // ========================================================================
      // Validation Methods
      // ========================================================================

      validateStep: async (
        stepId: string,
        context?: unknown
      ): Promise<boolean> => {
        const currentStep = get().getCurrentStep();
        if (!currentStep || currentStep.id !== stepId) {
          return false;
        }

        const validation = currentStep.validation;
        if (!validation) {
          // No validation required
          return true;
        }

        // Set validating state
        set({
          validationState: {
            isValidating: true,
            isValid: false,
            feedback: "",
          },
        });

        try {
          // Parse and execute the validation condition
          // The condition is stored as a string and should be a function expression
          let isValid = false;

          try {
            // Create a function from the condition string
            // The condition should return a boolean
            const validationFn = new Function(
              "context",
              `return ${validation.condition}`
            );
            isValid = await validationFn(context);
          } catch (error) {
            console.error("Validation error:", error);
            isValid = false;
          }

          // Record the attempt
          get().recordValidationAttempt(stepId, isValid);

          // Update validation state with feedback
          set({
            validationState: {
              isValidating: false,
              isValid,
              feedback: isValid
                ? validation.feedback.success
                : validation.feedback.failure,
            },
          });

          return isValid;
        } catch (error) {
          console.error("Validation failed:", error);

          set({
            validationState: {
              isValidating: false,
              isValid: false,
              feedback: validation.feedback.failure,
            },
          });

          get().recordValidationAttempt(stepId, false);
          return false;
        }
      },

      recordValidationAttempt: (stepId: string, success: boolean) => {
        const attempt: ValidationAttempt = {
          stepId,
          timestamp: Date.now(),
          success,
        };

        set((state) => ({
          validationAttempts: [...state.validationAttempts, attempt],
        }));
      },

      // ========================================================================
      // Tutorial Trigger Methods
      // ========================================================================

      checkTriggers: (_page: string, _context?: unknown): Tutorial | null => {
        // This is a placeholder implementation
        // In a real application, you would:
        // 1. Load all available tutorials
        // 2. Check their trigger conditions
        // 3. Return the first matching tutorial that should be shown

        // For now, just return null
        // This should be implemented based on your tutorial loading mechanism
        return null;
      },

      recordTriggerShown: (tutorialId: string) => {
        set((state) => {
          const existingRecord = state.triggerHistory.find(
            (record) => record.tutorialId === tutorialId
          );

          if (existingRecord) {
            // Update existing record
            return {
              triggerHistory: state.triggerHistory.map((record) =>
                record.tutorialId === tutorialId
                  ? {
                      ...record,
                      timestamp: Date.now(),
                      count: record.count + 1,
                    }
                  : record
              ),
            };
          } else {
            // Add new record
            return {
              triggerHistory: [
                ...state.triggerHistory,
                {
                  tutorialId,
                  timestamp: Date.now(),
                  count: 1,
                },
              ],
            };
          }
        });
      },

      shouldShowTrigger: (tutorialId: string): boolean => {
        const { triggerHistory, completedTutorials, dontShowTutorialsAgain } =
          get();

        // Don't show if user disabled tutorials
        if (dontShowTutorialsAgain) {
          return false;
        }

        // Don't show if already completed
        if (completedTutorials.includes(tutorialId)) {
          return false;
        }

        // Check trigger history
        const record = triggerHistory.find((r) => r.tutorialId === tutorialId);

        // Don't show if shown more than 3 times
        if (record && record.count >= 3) {
          return false;
        }

        // Don't show if shown within last 24 hours
        if (record) {
          const dayInMs = 24 * 60 * 60 * 1000;
          const timeSinceLastShown = Date.now() - record.timestamp;
          if (timeSinceLastShown < dayInMs) {
            return false;
          }
        }

        return true;
      },
    }),
    {
      name: "qontinui-tutorial-state",
      version: 2, // Incremented version for new fields
      partialize: (state) => ({
        completedTutorials: state.completedTutorials,
        dontShowTutorialsAgain: state.dontShowTutorialsAgain,
        inProgressTutorials: state.inProgressTutorials,
        validationAttempts: state.validationAttempts,
        triggerHistory: state.triggerHistory,
        contextualPanelCollapsed: state.contextualPanelCollapsed,
        // Note: targetElement, tooltipPosition, and validationState are not persisted
        // as they are transient UI state that should not survive page reloads
      }),
    }
  )
);

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to check if any tutorials are in progress
 */
export function useHasInProgressTutorials(): boolean {
  return useTutorialStore((state) => state.inProgressTutorials.length > 0);
}

/**
 * Hook to get completed tutorial count
 */
export function useCompletedTutorialCount(): number {
  return useTutorialStore((state) => state.completedTutorials.length);
}

/**
 * Hook to get in-progress tutorial count
 */
export function useInProgressTutorialCount(): number {
  return useTutorialStore((state) => state.inProgressTutorials.length);
}
