/**
 * ContextualTutorialEnhanced Component
 *
 * Enhanced version of ContextualTutorial with event-driven progression.
 * Integrates useTutorialEvents, useTutorialKeyboard hooks for advanced features.
 * Supports wait conditions, timeouts, hints, and step skipping.
 */

"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { useTutorialStore } from "@/stores/tutorial-store";
import { evaluateTutorialCondition } from "@/lib/safe-eval";
import { useTutorialEvents } from "@/hooks/tutorial/useTutorialEvents";
import { useTutorialKeyboard } from "@/hooks/tutorial/useTutorialKeyboard";
import type { Tutorial, TourState } from "@/types/tutorial";
import { SpotlightOverlay } from "./SpotlightOverlay";
import { TutorialTooltip } from "./TutorialTooltip";
import { CenteredTooltip } from "./CenteredTooltip";
import { TutorialPanel } from "./TutorialPanel";
import { ValidationFeedback, ValidationStatus } from "./ValidationFeedback";

export interface ContextualTutorialEnhancedProps {
  /** Tutorial to display (if not using store) */
  tutorial?: Tutorial | null;
  /** Whether the tutorial is active */
  isActive?: boolean;
  /** Show progress panel */
  showPanel?: boolean;
  /** Panel position */
  panelPosition?: "left" | "right";
  /** Allow skipping steps */
  allowSkip?: boolean;
  /** Enable keyboard navigation */
  enableKeyboard?: boolean;
  /** Callback when tutorial completes */
  onComplete?: () => void;
  /** Callback when tutorial is closed */
  onClose?: () => void;
  /** Custom class name */
  className?: string;
}

export const ContextualTutorialEnhanced: React.FC<
  ContextualTutorialEnhancedProps
> = ({
  tutorial: propTutorial,
  isActive: propIsActive,
  showPanel = false,
  panelPosition = "right",
  allowSkip = true,
  enableKeyboard = true,
  onComplete,
  onClose,
  className = "",
}) => {
  const {
    currentTutorial: storeTutorial,
    currentStepIndex,
    isOpen: storeIsOpen,
    nextStep,
    previousStep,
    goToStep,
    completeTutorial,
    skipTutorial,
    getCurrentStep,
    isFirstStep,
    isLastStep,
  } = useTutorialStore();

  // Use prop tutorial or store tutorial
  const tutorial = propTutorial ?? storeTutorial;
  const isActive = propIsActive ?? storeIsOpen;

  const [validationStatus, setValidationStatus] =
    useState<ValidationStatus>("idle");
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [tourData] = useState<Record<string, unknown>>({});

  const currentStep = getCurrentStep();

  // Build tour state for event filters
  const tourState = useMemo<TourState>(
    () => ({
      stepIndex: currentStepIndex,
      tutorialId: tutorial?.id ?? "",
      data: tourData,
    }),
    [currentStepIndex, tutorial?.id, tourData]
  );

  // Handle successful step completion
  const handleStepComplete = useCallback(async () => {
    if (!currentStep) return;

    // Run step complete callback if exists
    if (currentStep.complete) {
      try {
        await currentStep.complete();
      } catch (error) {
        console.error("Step complete callback error:", error);
      }
    }

    // Mark step as completed
    setCompletedStepIds((prev) =>
      prev.includes(currentStep.id) ? prev : [...prev, currentStep.id]
    );

    // Show success animation briefly
    setShowSuccessAnimation(true);
    setTimeout(() => setShowSuccessAnimation(false), 500);

    setValidationStatus("idle");

    if (isLastStep()) {
      completeTutorial();
      onComplete?.();
    } else {
      nextStep();
    }
  }, [currentStep, isLastStep, nextStep, completeTutorial, onComplete]);

  // Event-driven progression
  const {
    isWaiting,
    isTimedOut: _isTimedOut,
    hintMessage,
    canSkip: eventCanSkip,
    notifyAction,
  } = useTutorialEvents({
    waitCondition: currentStep?.wait,
    tourState,
    onAdvance: handleStepComplete,
    enabled: isActive && !!currentStep?.wait,
  });

  // Keyboard navigation
  useTutorialKeyboard({
    onNext: handleNext,
    onPrevious: handlePrevious,
    onClose: handleClose,
    onComplete: handleStepComplete,
    enabled: enableKeyboard && isActive && !isWaiting,
    isFirstStep: isFirstStep(),
    isLastStep: isLastStep(),
    isWaiting,
  });

  // Execute prepare callback when step changes
  useEffect(() => {
    if (!currentStep?.prepare || !isActive) return;

    const runPrepare = async () => {
      try {
        await currentStep.prepare?.();
      } catch (error) {
        console.error("Step prepare callback error:", error);
      }
    };

    runPrepare();
  }, [currentStep, isActive]);

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

  // Handle validation for interactive steps
  const validateStep = useCallback(async () => {
    if (!currentStep?.validation) {
      return true;
    }

    setValidationStatus("validating");

    const { condition, optional = false } = currentStep.validation;

    try {
      // Evaluate validation condition by registered name
      const isValid = await evaluateTutorialCondition(condition);

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
  async function handleNext() {
    if (!currentStep) return;

    // If step has wait condition and we're waiting, don't advance manually
    if (currentStep.wait && isWaiting && !eventCanSkip) {
      return;
    }

    // Validate if needed
    if (currentStep.validation) {
      const isValid = await validateStep();
      if (!isValid) {
        return;
      }
    }

    await handleStepComplete();
  }

  // Handle previous step
  function handlePrevious() {
    setValidationStatus("idle");
    setShowSuccessAnimation(false);
    previousStep();
  }

  // Handle skip (from timeout)
  function handleSkip() {
    setValidationStatus("idle");
    setShowSuccessAnimation(false);
    // Move to next step without marking complete
    if (isLastStep()) {
      completeTutorial();
      onComplete?.();
    } else {
      nextStep();
    }
  }

  // Handle close
  function handleClose() {
    skipTutorial();
    onClose?.();
  }

  // Handle step click from panel
  const handleStepClick = useCallback(
    (stepIndex: number) => {
      setValidationStatus("idle");
      setShowSuccessAnimation(false);
      goToStep(stepIndex);
    },
    [goToStep]
  );

  // Expose notifyAction globally for components to use
  useEffect(() => {
    if (typeof window !== "undefined") {
      (
        window as unknown as { __tutorialNotifyAction?: typeof notifyAction }
      ).__tutorialNotifyAction = notifyAction;
    }
    return () => {
      if (typeof window !== "undefined") {
        delete (
          window as unknown as { __tutorialNotifyAction?: typeof notifyAction }
        ).__tutorialNotifyAction;
      }
    };
  }, [notifyAction]);

  if (!tutorial || !isActive || !currentStep) {
    return null;
  }

  const targetElement = currentStep.targetElement;
  const targetSelector = targetElement?.selector || null;
  const tooltipPosition = targetElement?.position || "bottom";
  const allowInteraction =
    targetElement?.allowInteraction ?? currentStep.interactive ?? false;
  const hasTarget = !!targetSelector;

  return (
    <div className={`contextual-tutorial-enhanced ${className}`}>
      <AnimatePresence mode="wait">
        {/* Spotlight Overlay (only if has target) */}
        {hasTarget && (
          <SpotlightOverlay
            key="spotlight"
            targetSelector={targetSelector}
            allowInteraction={allowInteraction || isWaiting}
            isVisible={isActive}
          />
        )}

        {/* Positioned Tooltip (when has target) */}
        {hasTarget && (
          <TutorialTooltip
            key={`tooltip-${currentStepIndex}`}
            targetSelector={targetSelector}
            title={currentStep.title}
            content={currentStep.content}
            position={tooltipPosition}
            currentStep={currentStepIndex + 1}
            totalSteps={tutorial.steps.length}
            isFirstStep={isFirstStep()}
            isLastStep={isLastStep()}
            showPrevious={!isFirstStep()}
            showNext={!isWaiting}
            showSkip={allowSkip && !isLastStep && !isWaiting}
            showClose={true}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onSkip={handleClose}
            onClose={handleClose}
            offset={targetElement?.offset}
            isVisible={isActive}
          />
        )}

        {/* Centered Tooltip (when no target) */}
        {!hasTarget && (
          <CenteredTooltip
            key={`centered-${currentStepIndex}`}
            title={currentStep.title}
            content={currentStep.content}
            action={currentStep.action}
            currentStep={currentStepIndex + 1}
            totalSteps={tutorial.steps.length}
            isFirstStep={isFirstStep()}
            isLastStep={isLastStep()}
            isWaiting={isWaiting}
            hintMessage={hintMessage}
            canSkip={eventCanSkip}
            showPrevious={!isFirstStep()}
            showNext={!isWaiting}
            showClose={true}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onClose={handleClose}
            onSkip={handleSkip}
            isVisible={isActive}
            showSuccess={showSuccessAnimation}
          />
        )}

        {/* Progress Panel */}
        {showPanel && (
          <TutorialPanel
            key="panel"
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
            key="validation"
            status={validationStatus}
            successMessage={currentStep.validation.feedback.success}
            failureMessage={currentStep.validation.feedback.failure}
            hint={currentStep.validation.feedback.hint}
            asToast={true}
            onDismiss={() => setValidationStatus("idle")}
          />
        )}
      </AnimatePresence>

      {/* Waiting indicator for positioned tooltip */}
      {hasTarget && isWaiting && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[10003] bg-surface-raised rounded-lg px-4 py-2 shadow-lg border border-border-default">
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <span>Waiting for action</span>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary tutorial-waiting-dot-1" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary tutorial-waiting-dot-2" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary tutorial-waiting-dot-3" />
            </div>
          </div>
          {hintMessage && (
            <p className="text-xs text-warning mt-1">{hintMessage}</p>
          )}
          {eventCanSkip && (
            <button
              onClick={handleSkip}
              className="text-xs text-text-muted hover:text-text-primary mt-1 underline"
            >
              Skip this step
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ContextualTutorialEnhanced;
