import { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, X, Check } from "lucide-react";
import type { TooltipPosition, TutorialStep } from "../types";

interface TutorialTooltipProps {
  tooltipPos: TooltipPosition;
  currentStep: TutorialStep;
  currentStepIndex: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  isAnimating: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

export const TutorialTooltip = forwardRef<HTMLDivElement, TutorialTooltipProps>(
  function TutorialTooltip(
    {
      tooltipPos,
      currentStep,
      currentStepIndex,
      totalSteps,
      isFirstStep,
      isLastStep,
      isAnimating,
      onNext,
      onPrevious,
      onSkip,
    },
    ref
  ) {
    return (
      <Card
        ref={ref}
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
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h3
                id="tutorial-title"
                className="text-lg font-semibold text-white mb-1"
              >
                {currentStep.title}
              </h3>
              <p className="text-xs text-text-muted">
                Step {currentStepIndex + 1} of {totalSteps}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSkip}
              className="text-text-muted hover:text-white -mr-2 -mt-2"
              aria-label="Skip tutorial"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <p
            id="tutorial-description"
            className="text-sm text-text-secondary mb-6 leading-relaxed"
          >
            {currentStep.description}
          </p>

          <div className="mb-6">
            <div className="flex gap-1">
              {Array.from({ length: totalSteps }).map((_, index) => (
                <div
                  key={index}
                  className={`
                    h-1 flex-1 rounded-full transition-all duration-300
                    ${
                      index <= currentStepIndex
                        ? "bg-brand-primary"
                        : "bg-border-default"
                    }
                  `}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isFirstStep && (
              <Button
                variant="outline"
                size="sm"
                onClick={onPrevious}
                disabled={isAnimating}
                className="flex-1 border-border-default hover:border-border-default hover:bg-surface-raised"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
            )}

            <Button
              size="sm"
              onClick={onNext}
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
              onClick={onSkip}
              disabled={isAnimating}
              className="text-text-muted hover:text-white"
            >
              Skip
            </Button>
          </div>

          <p className="text-xs text-text-muted mt-4 text-center">
            Use arrow keys to navigate • ESC to skip
          </p>
        </CardContent>
      </Card>
    );
  }
);
