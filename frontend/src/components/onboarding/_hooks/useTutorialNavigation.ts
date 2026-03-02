import { useCallback, useEffect, useState } from "react";
import { useOnboardingStore } from "@/stores/onboarding-store";
import type { TutorialStep } from "../types";
import { ANIMATION_DURATION, TUTORIAL_STEPS } from "../types";

export function useTutorialNavigation() {
  const {
    showTutorialOverlay,
    currentTourStep,
    setTourStep,
    completeTour,
    skipTour,
  } = useOnboardingStore();

  const [isAnimating, setIsAnimating] = useState(false);

  const currentStep: TutorialStep | undefined = TUTORIAL_STEPS[currentTourStep];
  const isLastStep = currentTourStep === TUTORIAL_STEPS.length - 1;
  const isFirstStep = currentTourStep === 0;
  const totalSteps = TUTORIAL_STEPS.length;

  const goToNextStep = useCallback(() => {
    if (isLastStep) {
      completeTour();
    } else {
      setIsAnimating(true);
      setTimeout(() => {
        setTourStep(currentTourStep + 1);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  }, [isLastStep, currentTourStep, setTourStep, completeTour]);

  const goToPreviousStep = useCallback(() => {
    if (!isFirstStep) {
      setIsAnimating(true);
      setTimeout(() => {
        setTourStep(currentTourStep - 1);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  }, [isFirstStep, currentTourStep, setTourStep]);

  const handleSkip = useCallback(() => {
    skipTour();
  }, [skipTour]);

  const handleTargetClick = useCallback(() => {
    if (!isAnimating) {
      goToNextStep();
    }
  }, [isAnimating, goToNextStep]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showTutorialOverlay) return;

      switch (e.key) {
        case "ArrowRight":
        case "Enter":
          e.preventDefault();
          goToNextStep();
          break;

        case "ArrowLeft":
          e.preventDefault();
          goToPreviousStep();
          break;

        case "Escape":
          e.preventDefault();
          handleSkip();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showTutorialOverlay, goToNextStep, goToPreviousStep, handleSkip]);

  return {
    showTutorialOverlay,
    currentTourStep,
    currentStep,
    isLastStep,
    isFirstStep,
    totalSteps,
    isAnimating,
    goToNextStep,
    goToPreviousStep,
    handleSkip,
    handleTargetClick,
  };
}
