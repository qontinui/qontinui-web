"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTutorialNavigation } from "./_hooks/useTutorialNavigation";
import { useTutorialPositioning } from "./_hooks/useTutorialPositioning";
import { TutorialSpotlight } from "./_components/TutorialSpotlight";
import { TutorialTooltip } from "./_components/TutorialTooltip";

export type { TutorialStep } from "./types";

export function TutorialOverlay() {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const {
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
  } = useTutorialNavigation();

  const { spotlightPos, tooltipPos, tooltipRef, updatePositions } =
    useTutorialPositioning(currentStep);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!showTutorialOverlay) return;

    updatePositions();

    const handleResize = () => {
      updatePositions();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, { passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize);
    };
  }, [showTutorialOverlay, currentTourStep, updatePositions]);

  useEffect(() => {
    if (!showTutorialOverlay || !currentStep) return;

    const targetElement = document.querySelector(currentStep.target);
    if (!targetElement) return;

    targetElement.addEventListener("click", handleTargetClick);
    return () => targetElement.removeEventListener("click", handleTargetClick);
  }, [showTutorialOverlay, currentStep, handleTargetClick]);

  if (!mounted || !showTutorialOverlay || !currentStep) {
    return null;
  }

  const overlayContent = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] transition-opacity duration-300"
      style={{ pointerEvents: "auto" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      aria-describedby="tutorial-description"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={handleSkip}
        aria-hidden="true"
      />

      {spotlightPos && <TutorialSpotlight spotlightPos={spotlightPos} />}

      {tooltipPos && (
        <TutorialTooltip
          ref={tooltipRef}
          tooltipPos={tooltipPos}
          currentStep={currentStep}
          currentStepIndex={currentTourStep}
          totalSteps={totalSteps}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          isAnimating={isAnimating}
          onNext={goToNextStep}
          onPrevious={goToPreviousStep}
          onSkip={handleSkip}
        />
      )}

      <style jsx>{`
        @keyframes pulse-glow {
          0%,
          100% {
            box-shadow:
              0 0 0 4px rgba(0, 217, 255, 0.3),
              0 0 0 1px rgba(0, 217, 255, 0.5),
              0 0 40px rgba(0, 217, 255, 0.4),
              inset 0 0 0 2px rgba(0, 217, 255, 0.2);
          }
          50% {
            box-shadow:
              0 0 0 4px rgba(0, 217, 255, 0.5),
              0 0 0 1px rgba(0, 217, 255, 0.7),
              0 0 60px rgba(0, 217, 255, 0.6),
              inset 0 0 0 2px rgba(0, 217, 255, 0.3);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(overlayContent, document.body);
}
