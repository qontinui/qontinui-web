"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, X, Check } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface TutorialStep {
  target: string; // CSS selector with data-tour attribute
  title: string;
  description: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
}

interface SpotlightPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: "top" | "bottom" | "left" | "right";
}

// ============================================================================
// Tutorial Steps Configuration
// ============================================================================

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: '[data-tour="projects"]',
    title: "Your Projects",
    description:
      "All your automation projects live here. Click to open or create new ones.",
    placement: "bottom",
  },
  {
    target: '[data-tour="new-project"]',
    title: "Create Project",
    description: "Start by creating your first automation project.",
    placement: "bottom",
  },
  {
    target: '[data-tour="quick-start"]',
    title: "Quick Start Guide",
    description: "Follow this checklist to build your first automation.",
    placement: "left",
  },
  {
    target: '[data-tour="documentation"]',
    title: "Documentation",
    description: "Need help? Access docs and tutorials anytime.",
    placement: "bottom",
  },
  {
    target: '[data-tour="profile"]',
    title: "Your Profile",
    description: "Manage settings, subscription, and account info.",
    placement: "bottom",
  },
];

// ============================================================================
// Constants
// ============================================================================

const SPOTLIGHT_PADDING = 8; // Padding around highlighted element
const TOOLTIP_OFFSET = 20; // Distance from highlighted element
const ANIMATION_DURATION = 300; // milliseconds

// ============================================================================
// Component
// ============================================================================

export function TutorialOverlay() {
  const {
    showTutorialOverlay,
    currentTourStep,
    setTourStep,
    completeTour,
    skipTour,
  } = useOnboardingStore();

  const [mounted, setMounted] = useState(false);
  const [spotlightPos, setSpotlightPos] = useState<SpotlightPosition | null>(
    null
  );
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Ensure component only renders on client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Current step data
  const currentStep = TUTORIAL_STEPS[currentTourStep];
  const isLastStep = currentTourStep === TUTORIAL_STEPS.length - 1;
  const isFirstStep = currentTourStep === 0;

  /**
   * Calculate spotlight position for target element
   */
  const calculateSpotlightPosition = useCallback(
    (element: Element): SpotlightPosition => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      };
    },
    []
  );

  /**
   * Calculate optimal tooltip position to avoid viewport edges
   */
  const calculateTooltipPosition = useCallback(
    (
      targetRect: DOMRect,
      tooltipWidth: number,
      tooltipHeight: number,
      preferredPlacement: TutorialStep["placement"] = "auto"
    ): TooltipPosition => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      // Calculate available space in each direction
      const spaceTop = targetRect.top;
      const spaceBottom = viewportHeight - targetRect.bottom;
      const spaceLeft = targetRect.left;
      const spaceRight = viewportWidth - targetRect.right;

      let placement: "top" | "bottom" | "left" | "right" = "bottom";
      let top = 0;
      let left = 0;

      // Determine best placement
      if (preferredPlacement === "auto") {
        // Auto-detect best placement based on available space
        if (spaceBottom >= tooltipHeight + TOOLTIP_OFFSET) {
          placement = "bottom";
        } else if (spaceTop >= tooltipHeight + TOOLTIP_OFFSET) {
          placement = "top";
        } else if (spaceRight >= tooltipWidth + TOOLTIP_OFFSET) {
          placement = "right";
        } else if (spaceLeft >= tooltipWidth + TOOLTIP_OFFSET) {
          placement = "left";
        } else {
          // Not enough space anywhere, default to bottom with scrolling
          placement = "bottom";
        }
      } else {
        placement = preferredPlacement;
      }

      // Calculate position based on placement
      switch (placement) {
        case "top":
          top = targetRect.top + scrollY - tooltipHeight - TOOLTIP_OFFSET;
          left =
            targetRect.left + scrollX + targetRect.width / 2 - tooltipWidth / 2;
          break;

        case "bottom":
          top = targetRect.bottom + scrollY + TOOLTIP_OFFSET;
          left =
            targetRect.left + scrollX + targetRect.width / 2 - tooltipWidth / 2;
          break;

        case "left":
          top =
            targetRect.top +
            scrollY +
            targetRect.height / 2 -
            tooltipHeight / 2;
          left = targetRect.left + scrollX - tooltipWidth - TOOLTIP_OFFSET;
          break;

        case "right":
          top =
            targetRect.top +
            scrollY +
            targetRect.height / 2 -
            tooltipHeight / 2;
          left = targetRect.right + scrollX + TOOLTIP_OFFSET;
          break;
      }

      // Ensure tooltip stays within viewport bounds (with some margin)
      const margin = 16;
      left = Math.max(
        margin,
        Math.min(left, viewportWidth - tooltipWidth - margin)
      );
      top = Math.max(
        margin + scrollY,
        Math.min(top, viewportHeight + scrollY - tooltipHeight - margin)
      );

      return { top, left, placement };
    },
    []
  );

  /**
   * Update positions of spotlight and tooltip
   */
  const updatePositions = useCallback(() => {
    if (!currentStep) return;

    const targetElement = document.querySelector(currentStep.target);
    if (!targetElement) {
      console.warn(`Tutorial target not found: ${currentStep.target}`);
      return;
    }

    // Scroll target into view if needed
    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    // Wait a bit for scroll to settle
    setTimeout(() => {
      const targetRect = targetElement.getBoundingClientRect();

      // Update spotlight position
      setSpotlightPos(calculateSpotlightPosition(targetElement));

      // Update tooltip position (use ref dimensions if available)
      const tooltipWidth = tooltipRef.current?.offsetWidth || 320;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 200;
      setTooltipPos(
        calculateTooltipPosition(
          targetRect,
          tooltipWidth,
          tooltipHeight,
          currentStep.placement
        )
      );
    }, 100);
  }, [currentStep, calculateSpotlightPosition, calculateTooltipPosition]);

  /**
   * Handle step navigation
   */
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
    // Allow clicking on target to proceed to next step
    if (!isAnimating) {
      goToNextStep();
    }
  }, [isAnimating, goToNextStep]);

  /**
   * Keyboard navigation
   */
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

  /**
   * Update positions when step changes or window resizes
   */
  useEffect(() => {
    if (!showTutorialOverlay) return;

    updatePositions();

    const handleResize = () => {
      updatePositions();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize);
    };
  }, [showTutorialOverlay, currentTourStep, updatePositions]);

  /**
   * Add click listener to target element
   */
  useEffect(() => {
    if (!showTutorialOverlay || !currentStep) return;

    const targetElement = document.querySelector(currentStep.target);
    if (!targetElement) return;

    targetElement.addEventListener("click", handleTargetClick);
    return () => targetElement.removeEventListener("click", handleTargetClick);
  }, [showTutorialOverlay, currentStep, handleTargetClick]);

  // Don't render on server or when not active
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
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* Spotlight SVG Mask */}
      {spotlightPos && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ mixBlendMode: "hard-light" }}
        >
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={spotlightPos.left}
                y={spotlightPos.top}
                width={spotlightPos.width}
                height={spotlightPos.height}
                rx="8"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.4)"
            mask="url(#spotlight-mask)"
          />
        </svg>
      )}

      {/* Spotlight highlight ring */}
      {spotlightPos && (
        <div
          className="absolute pointer-events-auto rounded-lg transition-all duration-300 ease-out"
          style={{
            top: `${spotlightPos.top}px`,
            left: `${spotlightPos.left}px`,
            width: `${spotlightPos.width}px`,
            height: `${spotlightPos.height}px`,
            boxShadow: `
              0 0 0 4px rgba(0, 217, 255, 0.3),
              0 0 0 1px rgba(0, 217, 255, 0.5),
              0 0 40px rgba(0, 217, 255, 0.4),
              inset 0 0 0 2px rgba(0, 217, 255, 0.2)
            `,
            animation: "pulse-glow 2s ease-in-out infinite",
          }}
        />
      )}

      {/* Tooltip */}
      {tooltipPos && (
        <Card
          ref={tooltipRef}
          className={`
            fixed bg-surface-raised/95 border-border-subtle/50 backdrop-blur-xl
            shadow-2xl transition-all duration-300 ease-out
            ${isAnimating ? "opacity-0 scale-95" : "opacity-100 scale-100"}
          `}
          style={{
            top: `${tooltipPos.top}px`,
            left: `${tooltipPos.left}px`,
            maxWidth: "360px",
            zIndex: 10001,
          }}
        >
          <CardContent className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3
                  id="tutorial-title"
                  className="text-lg font-semibold text-white mb-1"
                >
                  {currentStep.title}
                </h3>
                <p className="text-xs text-text-muted">
                  Step {currentTourStep + 1} of {TUTORIAL_STEPS.length}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-text-muted hover:text-white -mr-2 -mt-2"
                aria-label="Skip tutorial"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Description */}
            <p
              id="tutorial-description"
              className="text-sm text-text-secondary mb-6 leading-relaxed"
            >
              {currentStep.description}
            </p>

            {/* Progress indicator */}
            <div className="mb-6">
              <div className="flex gap-1">
                {TUTORIAL_STEPS.map((_, index) => (
                  <div
                    key={index}
                    className={`
                      h-1 flex-1 rounded-full transition-all duration-300
                      ${
                        index <= currentTourStep
                          ? "bg-brand-primary"
                          : "bg-border-default"
                      }
                    `}
                  />
                ))}
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center gap-3">
              {!isFirstStep && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToPreviousStep}
                  disabled={isAnimating}
                  className="flex-1 border-border-default hover:border-border-default hover:bg-surface-raised"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Previous
                </Button>
              )}

              <Button
                size="sm"
                onClick={goToNextStep}
                disabled={isAnimating}
                className={`
                  flex-1 font-medium
                  ${
                    isLastStep
                      ? "bg-brand-success hover:bg-brand-success/80 text-black"
                      : "bg-brand-primary hover:bg-brand-primary/80 text-black"
                  }
                `}
              >
                {isLastStep ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Complete
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                disabled={isAnimating}
                className="text-text-muted hover:text-white"
              >
                Skip
              </Button>
            </div>

            {/* Hint text */}
            <p className="text-xs text-text-muted mt-4 text-center">
              Use arrow keys to navigate • ESC to skip
            </p>
          </CardContent>
        </Card>
      )}

      {/* Global styles for animation */}
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

  // Render in portal to ensure it&apos;s at the top of the DOM
  return createPortal(overlayContent, document.body);
}
