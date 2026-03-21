/**
 * CenteredTooltip Component
 *
 * Fallback modal for tutorial steps without a target element.
 * Displays content centered on screen with a backdrop.
 */

import React from "react";
import { m, AnimatePresence, LazyMotion, domAnimation } from "framer-motion";
import { X, ArrowRight, ArrowLeft, CheckCircle } from "lucide-react";

export interface CenteredTooltipProps {
  /** Tooltip title */
  title: string;
  /** Tooltip content/description */
  content: string;
  /** Optional action instruction */
  action?: string;
  /** Current step number (1-indexed) */
  currentStep?: number;
  /** Total number of steps */
  totalSteps?: number;
  /** Whether this is the first step */
  isFirstStep?: boolean;
  /** Whether this is the last step */
  isLastStep?: boolean;
  /** Whether currently waiting for an event */
  isWaiting?: boolean;
  /** Hint message to show */
  hintMessage?: string | null;
  /** Whether the user can skip */
  canSkip?: boolean;
  /** Show Previous button */
  showPrevious?: boolean;
  /** Show Next button */
  showNext?: boolean;
  /** Show Close button */
  showClose?: boolean;
  /** Callback when Next is clicked */
  onNext?: () => void;
  /** Callback when Previous is clicked */
  onPrevious?: () => void;
  /** Callback when Close is clicked */
  onClose?: () => void;
  /** Callback when Skip is clicked */
  onSkip?: () => void;
  /** Whether tooltip is visible */
  isVisible?: boolean;
  /** Show success animation */
  showSuccess?: boolean;
  /** Custom class name */
  className?: string;
}

export const CenteredTooltip: React.FC<CenteredTooltipProps> = ({
  title,
  content,
  action,
  currentStep,
  totalSteps,
  isFirstStep = false,
  isLastStep = false,
  isWaiting = false,
  hintMessage,
  canSkip = false,
  showPrevious = true,
  showNext = true,
  showClose = true,
  onNext,
  onPrevious,
  onClose,
  onSkip,
  isVisible = true,
  showSuccess = false,
  className = "",
}) => {
  if (!isVisible) {
    return null;
  }

  return (
    <LazyMotion features={domAnimation}>
    <AnimatePresence>
      {/* Backdrop */}
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[10000] bg-black/75"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Centered Dialog */}
      <m.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className={`
          fixed z-[10002] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[calc(100%-32px)] max-w-md
          bg-white dark:bg-surface-raised rounded-lg shadow-2xl
          border border-border-subtle dark:border-border-default
          tutorial-scale-in
          ${className}
        `}
        role="dialog"
        aria-labelledby="centered-tooltip-title"
        aria-describedby="centered-tooltip-content"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-border-subtle dark:border-border-default">
          <div className="flex-1 pr-2">
            <div className="flex items-center gap-2">
              {showSuccess && (
                <m.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="tutorial-success-animation"
                >
                  <CheckCircle className="w-5 h-5 text-green-500" />
                </m.div>
              )}
              <h3
                id="centered-tooltip-title"
                className="text-lg font-semibold text-text-primary dark:text-white"
              >
                {title}
              </h3>
            </div>
            {currentStep !== undefined && totalSteps !== undefined && (
              <p className="text-xs text-text-muted dark:text-text-muted mt-0.5">
                Step {currentStep} of {totalSteps}
              </p>
            )}
          </div>
          {showClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 text-text-muted hover:text-text-primary dark:hover:text-text-secondary transition-colors"
              aria-label="Close tutorial"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div id="centered-tooltip-content" className="p-4">
          <p className="text-sm text-text-secondary dark:text-text-secondary whitespace-pre-wrap">
            {content}
          </p>

          {/* Action instruction */}
          {action && (
            <div className="tutorial-action-box mt-4">
              <p className="tutorial-action-box-text">{action}</p>
            </div>
          )}

          {/* Waiting indicator */}
          {isWaiting && (
            <div className="flex items-center gap-2 mt-4 text-text-muted">
              <span className="text-sm">Waiting for action</span>
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary tutorial-waiting-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary tutorial-waiting-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary tutorial-waiting-dot-3" />
              </div>
            </div>
          )}

          {/* Hint message */}
          {hintMessage && (
            <div className="tutorial-hint-box mt-4">
              <p className="tutorial-hint-text">{hintMessage}</p>
            </div>
          )}
        </div>

        {/* Footer with navigation buttons */}
        <div className="flex items-center justify-between p-4 border-t border-border-subtle dark:border-border-default gap-2">
          <div className="flex gap-2">
            {showPrevious && !isFirstStep && (
              <button
                onClick={onPrevious}
                disabled={isWaiting}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-text-secondary dark:text-text-secondary hover:bg-surface-raised dark:hover:bg-surface-hover rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Previous step"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {/* Skip button (only when timed out with allow-skip) */}
            {canSkip && isWaiting && (
              <button
                onClick={onSkip}
                className="px-3 py-1.5 text-sm font-medium text-text-muted dark:text-text-muted hover:text-text-primary dark:hover:text-text-secondary transition-colors"
                aria-label="Skip this step"
              >
                Skip
              </button>
            )}

            {showNext && !isWaiting && (
              <button
                onClick={onNext}
                className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded transition-colors"
                aria-label={isLastStep ? "Finish tutorial" : "Next step"}
              >
                <span>{isLastStep ? "Finish" : "Next"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </m.div>
    </AnimatePresence>
    </LazyMotion>
  );
};

export default CenteredTooltip;
