/**
 * Onboarding Store
 *
 * Manages user onboarding state and progress through various onboarding flows.
 * Persists to localStorage to track completion across sessions.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ============================================================================
// Types
// ============================================================================

export interface QuickStartProgress {
  /** User has uploaded their first screenshot */
  uploadedScreenshot: boolean;
  /** User has defined at least one state */
  definedState: boolean;
  /** User has created at least one transition */
  createdTransition: boolean;
  /** User has tested an automation */
  testedAutomation: boolean;
  /** User has exported a configuration */
  exportedConfig: boolean;
  /** User has watched the tutorial video */
  watchedTutorial: boolean;
}

export interface OnboardingState {
  /** Whether the user has completed the initial welcome flow */
  hasCompletedWelcome: boolean;

  /** Whether the user has started the guided tour */
  hasStartedTour: boolean;

  /** Current step in the guided tour (0-indexed) */
  currentTourStep: number;

  /** Whether the user has created their first project */
  hasCreatedFirstProject: boolean;

  /** Progress through the quick start checklist */
  quickStartProgress: QuickStartProgress;

  /** Whether to show the welcome modal */
  showWelcomeModal: boolean;

  /** Whether to show the tutorial overlay */
  showTutorialOverlay: boolean;

  /** Whether to show the quick start checklist */
  showQuickStartChecklist: boolean;

  /** User preference to not show welcome modal again */
  dontShowWelcomeAgain: boolean;
}

export interface OnboardingActions {
  /**
   * Mark welcome flow as completed
   */
  completeWelcome: () => void;

  /**
   * Start the guided tour
   */
  startTour: () => void;

  /**
   * Set the current tour step
   */
  setTourStep: (step: number) => void;

  /**
   * Complete the entire tour
   */
  completeTour: () => void;

  /**
   * Skip the tour
   */
  skipTour: () => void;

  /**
   * Mark that user has created their first project
   */
  createFirstProject: () => void;

  /**
   * Update progress on a specific quick start task
   */
  updateQuickStartProgress: (
    task: keyof QuickStartProgress,
    completed: boolean
  ) => void;

  /**
   * Toggle welcome modal visibility
   */
  toggleWelcomeModal: (show: boolean) => void;

  /**
   * Toggle tutorial overlay visibility
   */
  toggleTutorialOverlay: (show: boolean) => void;

  /**
   * Toggle quick start checklist visibility
   */
  toggleQuickStartChecklist: (show: boolean) => void;

  /**
   * Set user preference to not show welcome again
   */
  setDontShowWelcomeAgain: (value: boolean) => void;

  /**
   * Reset all onboarding state (for testing or user preference)
   */
  resetOnboarding: () => void;

  /**
   * Get overall onboarding completion percentage
   */
  getCompletionPercentage: () => number;

  /**
   * Check if all quick start tasks are completed
   */
  isQuickStartComplete: () => boolean;

  /**
   * Get number of completed quick start tasks
   */
  getCompletedQuickStartTasks: () => number;
}

export type OnboardingStore = OnboardingState & OnboardingActions;

// ============================================================================
// Initial State
// ============================================================================

const initialQuickStartProgress: QuickStartProgress = {
  uploadedScreenshot: false,
  definedState: false,
  createdTransition: false,
  testedAutomation: false,
  exportedConfig: false,
  watchedTutorial: false,
};

const initialState: OnboardingState = {
  hasCompletedWelcome: false,
  hasStartedTour: false,
  currentTourStep: 0,
  hasCreatedFirstProject: false,
  quickStartProgress: initialQuickStartProgress,
  showWelcomeModal: false,
  showTutorialOverlay: false,
  showQuickStartChecklist: false,
  dontShowWelcomeAgain: false,
};

// ============================================================================
// Store
// ============================================================================

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ========================================================================
      // Welcome Flow
      // ========================================================================

      completeWelcome: () => {
        set({
          hasCompletedWelcome: true,
          showWelcomeModal: false,
        });
      },

      toggleWelcomeModal: (show: boolean) => {
        set({ showWelcomeModal: show });
      },

      setDontShowWelcomeAgain: (value: boolean) => {
        set({
          dontShowWelcomeAgain: value,
          showWelcomeModal: value ? false : get().showWelcomeModal,
        });
      },

      // ========================================================================
      // Guided Tour
      // ========================================================================

      startTour: () => {
        set({
          hasStartedTour: true,
          currentTourStep: 0,
          showTutorialOverlay: true,
        });
      },

      setTourStep: (step: number) => {
        set({ currentTourStep: Math.max(0, step) });
      },

      completeTour: () => {
        set({
          hasStartedTour: true,
          currentTourStep: 0,
          showTutorialOverlay: false,
        });
      },

      skipTour: () => {
        set({
          hasStartedTour: true,
          currentTourStep: 0,
          showTutorialOverlay: false,
        });
      },

      toggleTutorialOverlay: (show: boolean) => {
        set({ showTutorialOverlay: show });
      },

      // ========================================================================
      // Project Creation
      // ========================================================================

      createFirstProject: () => {
        set({
          hasCreatedFirstProject: true,
          showQuickStartChecklist: true,
        });
      },

      // ========================================================================
      // Quick Start Progress
      // ========================================================================

      updateQuickStartProgress: (
        task: keyof QuickStartProgress,
        completed: boolean
      ) => {
        set((state) => ({
          quickStartProgress: {
            ...state.quickStartProgress,
            [task]: completed,
          },
        }));
      },

      toggleQuickStartChecklist: (show: boolean) => {
        set({ showQuickStartChecklist: show });
      },

      isQuickStartComplete: (): boolean => {
        const { quickStartProgress } = get();
        return Object.values(quickStartProgress).every(
          (value) => value === true
        );
      },

      getCompletedQuickStartTasks: (): number => {
        const { quickStartProgress } = get();
        return Object.values(quickStartProgress).filter(
          (value) => value === true
        ).length;
      },

      // ========================================================================
      // Analytics & Progress
      // ========================================================================

      getCompletionPercentage: (): number => {
        const state = get();
        let completed = 0;
        let total = 0;

        // Welcome flow (weight: 1)
        total += 1;
        if (state.hasCompletedWelcome) completed += 1;

        // Tour completion (weight: 1)
        total += 1;
        if (state.hasStartedTour && !state.showTutorialOverlay) completed += 1;

        // First project (weight: 1)
        total += 1;
        if (state.hasCreatedFirstProject) completed += 1;

        // Quick start tasks (weight: 6 - one per task)
        const quickStartTasks = Object.values(state.quickStartProgress);
        total += quickStartTasks.length;
        completed += quickStartTasks.filter((task) => task).length;

        return total > 0 ? Math.round((completed / total) * 100) : 0;
      },

      // ========================================================================
      // Reset
      // ========================================================================

      resetOnboarding: () => {
        set(initialState);
      },
    }),
    {
      name: "qontinui-onboarding-state",
      version: 1,
      // Persist all state to localStorage
      partialize: (state) => ({
        hasCompletedWelcome: state.hasCompletedWelcome,
        hasStartedTour: state.hasStartedTour,
        currentTourStep: state.currentTourStep,
        hasCreatedFirstProject: state.hasCreatedFirstProject,
        quickStartProgress: state.quickStartProgress,
        showWelcomeModal: state.showWelcomeModal,
        showTutorialOverlay: state.showTutorialOverlay,
        showQuickStartChecklist: state.showQuickStartChecklist,
        dontShowWelcomeAgain: state.dontShowWelcomeAgain,
      }),
    }
  )
);

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to get whether onboarding is complete
 */
export function useIsOnboardingComplete(): boolean {
  return useOnboardingStore((state) => state.getCompletionPercentage() === 100);
}

/**
 * Hook to get quick start completion status
 */
export function useIsQuickStartComplete(): boolean {
  return useOnboardingStore((state) => state.isQuickStartComplete());
}

/**
 * Hook to get completion percentage
 */
export function useOnboardingProgress(): number {
  return useOnboardingStore((state) => state.getCompletionPercentage());
}

/**
 * Hook to get quick start progress count
 */
export function useQuickStartProgress(): { completed: number; total: number } {
  const completed = useOnboardingStore((state) =>
    state.getCompletedQuickStartTasks()
  );
  return { completed, total: 6 }; // 6 quick start tasks
}

/**
 * Hook to check if welcome should be shown
 */
export function useShouldShowWelcome(): boolean {
  return useOnboardingStore(
    (state) =>
      !state.hasCompletedWelcome &&
      !state.dontShowWelcomeAgain &&
      state.showWelcomeModal
  );
}
