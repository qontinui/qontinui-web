"use client";

/**
 * Tutorial Context Provider
 *
 * Wraps the existing Zustand tutorial store with additional functionality:
 * - Navigation via Next.js router
 * - Target element registry for components
 * - Event notification (notifyAction)
 * - Compatible API with runner for future unification
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTutorialStore } from "@/stores/tutorial-store";
import { dispatchTutorialAction } from "@/hooks/tutorial/useTutorialEvents";
import type {
  Tutorial,
  TutorialStep,
  TutorialMode,
  TourState,
  TutorialProgress,
} from "@/types/tutorial";

// ============================================================================
// Context Types
// ============================================================================

export interface TutorialContextValue {
  // State from store
  currentTutorial: Tutorial | null;
  currentStepIndex: number;
  currentStep: TutorialStep | null;
  isOpen: boolean;
  currentMode: TutorialMode | null;
  completedTutorials: string[];
  inProgressTutorials: string[];
  dontShowAgain: boolean;

  // Navigation
  isFirstStep: boolean;
  isLastStep: boolean;
  completionPercentage: number;

  // Highlighting
  targetElement: HTMLElement | null;

  // Tour state for event filters
  tourState: TourState;

  // Actions
  openTutorial: (tutorial: Tutorial, mode?: TutorialMode) => void;
  closeTutorial: () => void;
  nextStep: () => Promise<void>;
  previousStep: () => void;
  goToStep: (index: number) => void;
  completeTutorial: () => void;
  skipTutorial: () => void;
  setDontShowAgain: (value: boolean) => void;
  resetProgress: () => void;

  // Element registry
  registerTarget: (id: string, element: HTMLElement) => void;
  unregisterTarget: (id: string) => void;
  getTarget: (id: string) => HTMLElement | null;

  // Event notification
  notifyAction: (actionName: string, data?: unknown) => void;

  // Navigation helpers
  navigateTo: (path: string) => void;
}

export interface TutorialProgressContextValue {
  completedTutorials: string[];
  inProgressTutorials: string[];
  isTutorialCompleted: (tutorialId: string) => boolean;
  isTutorialInProgress: (tutorialId: string) => boolean;
  getProgress: (tutorialId: string) => TutorialProgress | null;
}

export interface TutorialAwareProps {
  tutorialId: string;
  className?: string;
  children: ReactNode;
}

// ============================================================================
// Contexts
// ============================================================================

const TutorialContext = createContext<TutorialContextValue | null>(null);
const TutorialProgressContext =
  createContext<TutorialProgressContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

interface TutorialProviderProps {
  children: ReactNode;
}

export function TutorialProvider({ children }: TutorialProviderProps) {
  const router = useRouter();
  const store = useTutorialStore();
  const targetRegistryRef = useRef<Map<string, HTMLElement>>(new Map());
  const [tourData, setTourData] = useState<Record<string, unknown>>({});

  // Compute current step
  const currentStep = useMemo(() => {
    if (!store.currentTutorial) return null;
    return store.currentTutorial.steps[store.currentStepIndex] ?? null;
  }, [store.currentTutorial, store.currentStepIndex]);

  // Compute tour state
  const tourState = useMemo<TourState>(
    () => ({
      stepIndex: store.currentStepIndex,
      tutorialId: store.currentTutorial?.id ?? "",
      data: tourData,
    }),
    [store.currentStepIndex, store.currentTutorial?.id, tourData]
  );

  // Navigation helper
  const navigateTo = useCallback(
    (path: string) => {
      router.push(path);
    },
    [router]
  );

  // Target element registry
  const registerTarget = useCallback((id: string, element: HTMLElement) => {
    targetRegistryRef.current.set(id, element);
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    targetRegistryRef.current.delete(id);
  }, []);

  const getTarget = useCallback((id: string): HTMLElement | null => {
    return targetRegistryRef.current.get(id) ?? null;
  }, []);

  // Event notification
  const notifyAction = useCallback((actionName: string, data?: unknown) => {
    dispatchTutorialAction(actionName, data);
    // Also store in tour data
    setTourData((prev) => ({
      ...prev,
      lastAction: actionName,
      lastActionData: data,
    }));
  }, []);

  // Open tutorial with optional navigation
  const openTutorial = useCallback(
    (tutorial: Tutorial, mode?: TutorialMode) => {
      // Navigate to focus page if specified
      if (tutorial.targetPage) {
        router.push(tutorial.targetPage);
      }

      // Reset tour data
      setTourData({});

      // Open via store
      store.openTutorial(tutorial, mode);
    },
    [router, store]
  );

  // Progress context value
  const progressValue = useMemo<TutorialProgressContextValue>(
    () => ({
      completedTutorials: store.completedTutorials,
      inProgressTutorials: store.inProgressTutorials,
      isTutorialCompleted: (id: string) =>
        store.completedTutorials.includes(id),
      isTutorialInProgress: (id: string) =>
        store.inProgressTutorials.includes(id),
      getProgress: (_id: string) => null, // TODO: Implement when progress records are added to store
    }),
    [store.completedTutorials, store.inProgressTutorials]
  );

  // Main context value
  const value = useMemo<TutorialContextValue>(
    () => ({
      // State
      currentTutorial: store.currentTutorial,
      currentStepIndex: store.currentStepIndex,
      currentStep,
      isOpen: store.isOpen,
      currentMode: store.currentMode,
      completedTutorials: store.completedTutorials,
      inProgressTutorials: store.inProgressTutorials,
      dontShowAgain: store.dontShowTutorialsAgain,

      // Navigation
      isFirstStep: store.isFirstStep(),
      isLastStep: store.isLastStep(),
      completionPercentage: store.getCompletionPercentage(),

      // Highlighting
      targetElement: store.targetElement,

      // Tour state
      tourState,

      // Actions
      openTutorial,
      closeTutorial: store.closeTutorial,
      nextStep: store.nextStep,
      previousStep: store.previousStep,
      goToStep: store.goToStep,
      completeTutorial: store.completeTutorial,
      skipTutorial: store.skipTutorial,
      setDontShowAgain: store.setDontShowTutorials,
      resetProgress: store.resetTutorials,

      // Element registry
      registerTarget,
      unregisterTarget,
      getTarget,

      // Event notification
      notifyAction,

      // Navigation
      navigateTo,
    }),
    [
      store,
      currentStep,
      tourState,
      openTutorial,
      registerTarget,
      unregisterTarget,
      getTarget,
      notifyAction,
      navigateTo,
    ]
  );

  return (
    <TutorialContext.Provider value={value}>
      <TutorialProgressContext.Provider value={progressValue}>
        {children}
      </TutorialProgressContext.Provider>
    </TutorialContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access the full tutorial context
 */
export function useTutorial(): TutorialContextValue {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return context;
}

/**
 * Hook to access tutorial progress (lighter weight)
 */
export function useTutorialProgress(): TutorialProgressContextValue {
  const context = useContext(TutorialProgressContext);
  if (!context) {
    throw new Error(
      "useTutorialProgress must be used within a TutorialProvider"
    );
  }
  return context;
}

/**
 * Hook for components that are tutorial targets
 * Automatically registers the element when mounted
 */
export function useTutorialTarget(
  tutorialId: string,
  ref: React.RefObject<HTMLElement>
): void {
  const { registerTarget, unregisterTarget } = useTutorial();

  useEffect(() => {
    if (ref.current) {
      registerTarget(tutorialId, ref.current);
    }

    return () => {
      unregisterTarget(tutorialId);
    };
  }, [tutorialId, ref, registerTarget, unregisterTarget]);
}

/**
 * HOC-like hook for tutorial-aware components
 * Returns props to spread on the target element
 */
export function useTutorialAware(tutorialId: string): {
  "data-tutorial-id": string;
  ref: React.RefCallback<HTMLElement>;
} {
  const { registerTarget, unregisterTarget } = useTutorial();
  const elementRef = useRef<HTMLElement | null>(null);

  const refCallback = useCallback(
    (element: HTMLElement | null) => {
      // Cleanup old element
      if (elementRef.current) {
        unregisterTarget(tutorialId);
      }

      elementRef.current = element;

      // Register new element
      if (element) {
        registerTarget(tutorialId, element);
      }
    },
    [tutorialId, registerTarget, unregisterTarget]
  );

  return {
    "data-tutorial-id": tutorialId,
    ref: refCallback,
  };
}

// ============================================================================
// Exports
// ============================================================================

export { TutorialContext, TutorialProgressContext };
