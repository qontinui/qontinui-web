/**
 * Tutorial Store
 *
 * Manages interactive tutorial state and progress through tutorial steps.
 * Persists to localStorage to track completion across sessions.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export interface TutorialStep {
  /** Unique identifier for the step */
  id: string;
  /** Title of the step */
  title: string;
  /** Main content/description of the step */
  content: string;
  /** Optional: Additional details or code examples */
  details?: string;
  /** Optional: Action description (what user should do) */
  action?: string;
  /** Optional: Related keyboard shortcuts */
  shortcuts?: string[];
}

export interface Tutorial {
  /** Unique identifier for the tutorial */
  id: string;
  /** Tutorial title */
  title: string;
  /** Tutorial description */
  description?: string;
  /** Steps in the tutorial */
  steps: TutorialStep[];
  /** Category (e.g., 'getting-started', 'advanced', 'gaming') */
  category?: string;
  /** Estimated time to complete in minutes */
  estimatedTime?: number;
  /** Whether this tutorial is required for onboarding */
  isRequired?: boolean;
}

export interface TutorialState {
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
}

export interface TutorialActions {
  /**
   * Open a tutorial dialog
   */
  openTutorial: (tutorial: Tutorial) => void;

  /**
   * Close the tutorial dialog
   */
  closeTutorial: () => void;

  /**
   * Move to the next step
   */
  nextStep: () => void;

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
}

export type TutorialStore = TutorialState & TutorialActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: TutorialState = {
  currentTutorial: null,
  currentStepIndex: 0,
  isOpen: false,
  completedTutorials: [],
  dontShowTutorialsAgain: false,
  inProgressTutorials: [],
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

      openTutorial: (tutorial: Tutorial) => {
        set({
          currentTutorial: tutorial,
          currentStepIndex: 0,
          isOpen: true,
        });
        get().markInProgress(tutorial.id);
      },

      closeTutorial: () => {
        set({
          isOpen: false,
        });
      },

      // ========================================================================
      // Navigation
      // ========================================================================

      nextStep: () => {
        const { currentTutorial, currentStepIndex } = get();
        if (!currentTutorial) return;

        const maxSteps = currentTutorial.steps.length;
        if (currentStepIndex < maxSteps - 1) {
          set({ currentStepIndex: currentStepIndex + 1 });
        } else {
          // Auto-complete when reaching the end
          get().completeTutorial();
        }
      },

      previousStep: () => {
        const { currentStepIndex } = get();
        if (currentStepIndex > 0) {
          set({ currentStepIndex: currentStepIndex - 1 });
        }
      },

      goToStep: (stepIndex: number) => {
        const { currentTutorial } = get();
        if (!currentTutorial) return;

        const clampedIndex = Math.max(
          0,
          Math.min(stepIndex, currentTutorial.steps.length - 1)
        );
        set({ currentStepIndex: clampedIndex });
      },

      // ========================================================================
      // Completion & Progress
      // ========================================================================

      completeTutorial: () => {
        const { currentTutorial, completedTutorials, inProgressTutorials } = get();
        if (!currentTutorial) return;

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
        });
      },

      skipTutorial: () => {
        const { currentTutorial, inProgressTutorials } = get();
        if (!currentTutorial) return;

        const inProgress = new Set(inProgressTutorials);
        inProgress.delete(currentTutorial.id);

        set({
          inProgressTutorials: Array.from(inProgress),
          isOpen: false,
          currentTutorial: null,
          currentStepIndex: 0,
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
        set(initialState);
      },
    }),
    {
      name: 'qontinui-tutorial-state',
      version: 1,
      partialize: (state) => ({
        completedTutorials: state.completedTutorials,
        dontShowTutorialsAgain: state.dontShowTutorialsAgain,
        inProgressTutorials: state.inProgressTutorials,
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
