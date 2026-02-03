"use client";

/**
 * ContextualTutorial Component
 *
 * Main container for contextual tutorials that orchestrates all sub-components.
 * Manages tutorial state, coordinates SpotlightOverlay, TutorialTooltip, and TutorialPanel.
 * Handles step navigation, validation, and progression.
 */

import React, { useEffect, useState, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useTutorialStore } from "../../../stores/tutorial-store";
import type { Tutorial } from "../../../types/tutorial";
import { SpotlightOverlay } from "./SpotlightOverlay";
import { TutorialTooltip } from "./TutorialTooltip";
import { TutorialPanel } from "./TutorialPanel";
import { ValidationFeedback, ValidationStatus } from "./ValidationFeedback";

export interface ContextualTutorialProps {
  /** Tutorial to display */
  tutorial: Tutorial | null;
  /** Whether the tutorial is active */
  isActive?: boolean;
  /** Show progress panel */
  showPanel?: boolean;
  /** Panel position */
  panelPosition?: "left" | "right";
  /** Allow skipping steps */
  allowSkip?: boolean;
  /** Callback when tutorial completes */
  onComplete?: () => void;
  /** Callback when tutorial is closed */
  onClose?: () => void;
  /** Custom class name */
  className?: string;
}

export const ContextualTutorial: React.FC<ContextualTutorialProps> = ({
  tutorial,
  isActive = true,
  showPanel = true,
  panelPosition = "right",
  allowSkip = true,
  onComplete,
  onClose,
  className = "",
}) => {
  const {
    currentStepIndex,
    nextStep,
    previousStep,
    goToStep,
    completeTutorial,
    skipTutorial,
    getCurrentStep,
    isFirstStep,
    isLastStep,
  } = useTutorialStore();

  const [validationStatus, setValidationStatus] =
    useState<ValidationStatus>("idle");
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const currentStep = getCurrentStep();

  // Scroll target element into view when step changes
  useEffect(() => {
    if (!currentStep?.targetElement || !isActive) return undefined;

    const {
      selector,
      scrollIntoView = true,
      delay = 0,
    } = currentStep.targetElement;

    const scrollToElement = () => {
      const element = document.querySelector(selector);
      if (element && scrollIntoView) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }
    };

    if (delay > 0) {
      const timer = setTimeout(scrollToElement, delay);
      return () => clearTimeout(timer);
    } else {
      scrollToElement();
      return undefined;
    }
  }, [currentStep, isActive]);

  // Execute step actions
  useEffect(() => {
    if (!currentStep?.actions || !isActive) return;

    const { before, after } = currentStep.actions;

    // Execute before action
    if (before) {
      try {
        const beforeFn = new Function("return " + before)();
        if (typeof beforeFn === "function") {
          beforeFn();
        }
      } catch (error) {
        console.error("Error executing step before action:", error);
      }
    }

    // Cleanup: execute after action
    return () => {
      if (after) {
        try {
          const afterFn = new Function("return " + after)();
          if (typeof afterFn === "function") {
            afterFn();
          }
        } catch (error) {
          console.error("Error executing step after action:", error);
        }
      }
    };
  }, [currentStep, isActive]);

  // Handle validation for interactive steps
  const validateStep = useCallback(async () => {
    if (!currentStep?.validation) {
      return true;
    }

    setValidationStatus("validating");

    const { type: _type, condition, optional = false } = currentStep.validation;

    try {
      // Execute validation function
      const validationFn = new Function("return " + condition)();
      const isValid =
        typeof validationFn === "function" ? await validationFn() : false;

      if (isValid) {
        setValidationStatus("success");
        return true;
      } else {
        setValidationStatus("failure");
        return optional;
      }
    } catch (error) {
      console.error("Validation error:", error);
      setValidationStatus("failure");
      return optional;
    }
  }, [currentStep]);

  // Handle next step with validation
  const handleNext = useCallback(async () => {
    if (currentStep?.validation) {
      const isValid = await validateStep();
      if (!isValid) {
        return;
      }
    }

    // Mark current step as completed
    if (currentStep) {
      setCompletedStepIds((prev) =>
        prev.includes(currentStep.id) ? prev : [...prev, currentStep.id]
      );
    }

    setValidationStatus("idle");

    if (isLastStep()) {
      completeTutorial();
      onComplete?.();
    } else {
      nextStep();
    }
  }, [
    currentStep,
    validateStep,
    isLastStep,
    nextStep,
    completeTutorial,
    onComplete,
  ]);

  // Handle previous step
  const handlePrevious = useCallback(() => {
    setValidationStatus("idle");
    previousStep();
  }, [previousStep]);

  // Handle skip
  const handleSkip = useCallback(() => {
    skipTutorial();
    onClose?.();
  }, [skipTutorial, onClose]);

  // Handle close
  const handleClose = useCallback(() => {
    skipTutorial();
    onClose?.();
  }, [skipTutorial, onClose]);

  // Handle step click from panel
  const handleStepClick = useCallback(
    (stepIndex: number) => {
      setValidationStatus("idle");
      goToStep(stepIndex);
    },
    [goToStep]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === "Escape") {
        handleClose();
        return;
      }

      // Arrow keys for navigation (when not in input)
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isFirstStep()) {
          handlePrevious();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, handleNext, handlePrevious, handleClose, isFirstStep]);

  if (!tutorial || !isActive || !currentStep) {
    return null;
  }

  const targetElement = currentStep.targetElement;
  const targetSelector = targetElement?.selector || null;
  const tooltipPosition = targetElement?.position || "bottom";
  const allowInteraction = targetElement?.allowInteraction ?? false;

  return (
    <div className={`contextual-tutorial ${className}`}>
      <AnimatePresence>
        {/* Spotlight Overlay */}
        <SpotlightOverlay
          targetSelector={targetSelector}
          allowInteraction={allowInteraction}
          isVisible={isActive}
        />

        {/* Tooltip */}
        {targetSelector && (
          <TutorialTooltip
            targetSelector={targetSelector}
            title={currentStep.title}
            content={currentStep.content}
            position={tooltipPosition}
            currentStep={currentStepIndex + 1}
            totalSteps={tutorial.steps.length}
            isFirstStep={isFirstStep()}
            isLastStep={isLastStep()}
            showPrevious={!isFirstStep()}
            showNext={true}
            showSkip={allowSkip}
            showClose={true}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onSkip={handleSkip}
            onClose={handleClose}
            offset={targetElement?.offset}
            isVisible={isActive}
          />
        )}

        {/* Progress Panel */}
        {showPanel && (
          <TutorialPanel
            steps={tutorial.steps}
            currentStepIndex={currentStepIndex}
            completedStepIds={completedStepIds}
            onStepClick={handleStepClick}
            position={panelPosition}
          />
        )}

        {/* Validation Feedback */}
        {currentStep.validation && validationStatus !== "idle" && (
          <ValidationFeedback
            status={validationStatus}
            successMessage={currentStep.validation.feedback.success}
            failureMessage={currentStep.validation.feedback.failure}
            hint={currentStep.validation.feedback.hint}
            asToast={true}
            onDismiss={() => setValidationStatus("idle")}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default ContextualTutorial;
