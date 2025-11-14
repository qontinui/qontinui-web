/**
 * TutorialProvider - React Context Provider for Tutorial State
 *
 * Provides tutorial state management throughout the application using React Context.
 * Integrates with tutorial store and manages contextual vs overlay mode switching.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTutorialStore } from '@/stores/tutorial-store';
import type {
  Tutorial,
  TutorialStep,
  TutorialMode,
  TutorialProgress,
} from '@/types/tutorial';

// ============================================================================
// Types
// ============================================================================

interface TutorialContextValue {
  // Current State
  currentTutorial: Tutorial | null;
  currentStep: TutorialStep | null;
  currentStepIndex: number;
  mode: TutorialMode;
  isActive: boolean;

  // Progress
  progress: TutorialProgress | null;
  completionPercentage: number;

  // Control Methods
  startTutorial: (tutorial: Tutorial, mode?: TutorialMode) => void;
  stopTutorial: () => void;
  nextStep: () => void;
  previousStep: () => void;
  goToStep: (stepIndex: number) => void;
  completeTutorial: () => void;

  // Mode Management
  switchMode: (mode: TutorialMode) => void;

  // Target Elements
  registerTarget: (id: string, element: HTMLElement) => void;
  unregisterTarget: (id: string) => void;
  getTarget: (id: string) => HTMLElement | null;
}

// ============================================================================
// Context
// ============================================================================

const TutorialContext = createContext<TutorialContextValue | null>(null);

// ============================================================================
// Provider Props
// ============================================================================

interface TutorialProviderProps {
  children: React.ReactNode;
  defaultMode?: TutorialMode;
}

// ============================================================================
// Provider Component
// ============================================================================

export const TutorialProvider: React.FC<TutorialProviderProps> = ({
  children,
  defaultMode = 'overlay',
}) => {
  const location = useLocation();
  const [mode, setMode] = useState<TutorialMode>(defaultMode);
  const [targetElements, setTargetElements] = useState<Map<string, HTMLElement>>(
    new Map()
  );
  const [progress, setProgress] = useState<TutorialProgress | null>(null);

  // Get store state and actions
  const {
    currentTutorial,
    currentStepIndex,
    isOpen,
    openTutorial,
    closeTutorial,
    nextStep: storeNextStep,
    previousStep: storePreviousStep,
    goToStep: storeGoToStep,
    completeTutorial: storeCompleteTutorial,
    getCurrentStep,
    getCompletionPercentage,
  } = useTutorialStore();

  const currentStep = getCurrentStep();
  const completionPercentage = getCompletionPercentage();

  // ============================================================================
  // Tutorial Control Methods
  // ============================================================================

  const startTutorial = useCallback(
    (tutorial: Tutorial, tutorialMode?: TutorialMode) => {
      const effectiveMode = tutorialMode || tutorial.mode || defaultMode;
      setMode(effectiveMode);
      openTutorial(tutorial);

      // Initialize progress tracking
      const newProgress: TutorialProgress = {
        tutorialId: tutorial.id,
        currentStepIndex: 0,
        stepProgress: tutorial.steps.map((step) => ({
          stepId: step.id,
          completed: false,
          tryItCompleted: false,
          timestamp: Date.now(),
        })),
        startedAt: Date.now(),
        isActive: true,
        completionPercentage: 0,
      };
      setProgress(newProgress);
    },
    [openTutorial, defaultMode]
  );

  const stopTutorial = useCallback(() => {
    closeTutorial();
    setProgress(null);
    setTargetElements(new Map());
  }, [closeTutorial]);

  const nextStep = useCallback(() => {
    storeNextStep();

    // Update progress
    if (progress && currentTutorial) {
      const updatedProgress = { ...progress };
      const currentStepProgress = updatedProgress.stepProgress[currentStepIndex];
      if (currentStepProgress) {
        currentStepProgress.completed = true;
        currentStepProgress.timestamp = Date.now();
      }
      updatedProgress.currentStepIndex = Math.min(
        currentStepIndex + 1,
        currentTutorial.steps.length - 1
      );
      updatedProgress.completionPercentage = getCompletionPercentage();
      setProgress(updatedProgress);
    }
  }, [storeNextStep, progress, currentTutorial, currentStepIndex, getCompletionPercentage]);

  const previousStep = useCallback(() => {
    storePreviousStep();

    // Update progress
    if (progress) {
      const updatedProgress = { ...progress };
      updatedProgress.currentStepIndex = Math.max(currentStepIndex - 1, 0);
      updatedProgress.completionPercentage = getCompletionPercentage();
      setProgress(updatedProgress);
    }
  }, [storePreviousStep, progress, currentStepIndex, getCompletionPercentage]);

  const goToStep = useCallback(
    (stepIndex: number) => {
      storeGoToStep(stepIndex);

      // Update progress
      if (progress) {
        const updatedProgress = { ...progress };
        updatedProgress.currentStepIndex = stepIndex;
        updatedProgress.completionPercentage = getCompletionPercentage();
        setProgress(updatedProgress);
      }
    },
    [storeGoToStep, progress, getCompletionPercentage]
  );

  const completeTutorial = useCallback(() => {
    if (progress) {
      const updatedProgress = { ...progress };
      updatedProgress.completedAt = Date.now();
      updatedProgress.isActive = false;
      updatedProgress.completionPercentage = 100;
      setProgress(updatedProgress);
    }

    storeCompleteTutorial();
    setTargetElements(new Map());
  }, [storeCompleteTutorial, progress]);

  // ============================================================================
  // Mode Management
  // ============================================================================

  const switchMode = useCallback((newMode: TutorialMode) => {
    setMode(newMode);
  }, []);

  // ============================================================================
  // Target Element Management
  // ============================================================================

  const registerTarget = useCallback((id: string, element: HTMLElement) => {
    setTargetElements((prev) => {
      const next = new Map(prev);
      next.set(id, element);
      return next;
    });
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    setTargetElements((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const getTarget = useCallback(
    (id: string): HTMLElement | null => {
      return targetElements.get(id) || null;
    },
    [targetElements]
  );

  // ============================================================================
  // Effects
  // ============================================================================

  // Handle step changes for contextual mode
  useEffect(() => {
    if (mode === 'contextual' && currentStep?.targetElement) {
      const { selector, scrollIntoView, delay } = currentStep.targetElement;

      const focusTarget = () => {
        const element = getTarget(selector.replace('[data-tutorial-id="', '').replace('"]', ''));

        if (element) {
          if (scrollIntoView) {
            element.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'center',
            });
          }

          // Add focus highlight
          element.classList.add('tutorial-target-active');
        }
      };

      if (delay) {
        const timer = setTimeout(focusTarget, delay);
        return () => clearTimeout(timer);
      } else {
        focusTarget();
      }
    }

    // Cleanup focus highlights when step changes
    return () => {
      document.querySelectorAll('.tutorial-target-active').forEach((el) => {
        el.classList.remove('tutorial-target-active');
      });
    };
  }, [currentStep, mode, getTarget]);

  // Handle route changes - close contextual tutorials when navigating away
  useEffect(() => {
    if (mode === 'contextual' && currentTutorial?.targetPage) {
      if (!location.pathname.includes(currentTutorial.targetPage)) {
        stopTutorial();
      }
    }
  }, [location.pathname, mode, currentTutorial, stopTutorial]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const contextValue: TutorialContextValue = {
    currentTutorial,
    currentStep,
    currentStepIndex,
    mode,
    isActive: isOpen,
    progress,
    completionPercentage,
    startTutorial,
    stopTutorial,
    nextStep,
    previousStep,
    goToStep,
    completeTutorial,
    switchMode,
    registerTarget,
    unregisterTarget,
    getTarget,
  };

  return (
    <TutorialContext.Provider value={contextValue}>
      {children}
    </TutorialContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access tutorial context
 * @throws {Error} If used outside of TutorialProvider
 */
export const useTutorial = (): TutorialContextValue => {
  const context = useContext(TutorialContext);

  if (!context) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }

  return context;
};

// ============================================================================
// Exports
// ============================================================================

export type { TutorialContextValue };
