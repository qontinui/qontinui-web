"use client";

/**
 * ValidationFeedback Component
 *
 * Displays real-time validation feedback for interactive tutorial steps.
 * Shows success/failure messages with hints and animated transitions.
 */

import React, { useEffect, useRef, useState } from "react";
import { m, AnimatePresence, LazyMotion, domAnimation } from "framer-motion";
import { CheckCircle, XCircle, AlertCircle, Lightbulb } from "lucide-react";

export type ValidationStatus = "idle" | "validating" | "success" | "failure";

export interface ValidationFeedbackProps {
  /** Current validation status */
  status: ValidationStatus;
  /** Success message to display */
  successMessage?: string;
  /** Failure message to display */
  failureMessage?: string;
  /** Hint to help user succeed */
  hint?: string;
  /** Display as toast notification instead of inline */
  asToast?: boolean;
  /** Auto-hide success message after delay (ms) */
  autoHideDuration?: number;
  /** Callback when feedback is dismissed */
  onDismiss?: () => void;
  /** Custom class name */
  className?: string;
}

export const ValidationFeedback: React.FC<ValidationFeedbackProps> = ({
  status,
  successMessage = "Great job! You completed this step correctly.",
  failureMessage = "Not quite right. Please try again.",
  hint,
  asToast = false,
  autoHideDuration = 3000,
  onDismiss,
  className = "",
}) => {
  const [showHint, setShowHint] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const prevStatusRef = useRef(status);

  // Reset showHint and isVisible when status changes (ref comparison instead of useEffect)
  if (prevStatusRef.current !== status) {
    prevStatusRef.current = status;
    setShowHint(false);
    setIsVisible(true);
  }

  useEffect(() => {
    if (status === "success" && autoHideDuration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, autoHideDuration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [status, autoHideDuration, onDismiss]);

  if (status === "idle" || !isVisible) {
    return null;
  }

  const getIcon = () => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "failure":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "validating":
        return (
          <m.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            <AlertCircle className="w-5 h-5 text-blue-500" />
          </m.div>
        );
      default:
        return null;
    }
  };

  const getMessage = () => {
    switch (status) {
      case "success":
        return successMessage;
      case "failure":
        return failureMessage;
      case "validating":
        return "Validating your action...";
      default:
        return "";
    }
  };

  const getBackgroundClass = () => {
    switch (status) {
      case "success":
        return "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
      case "failure":
        return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
      case "validating":
        return "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
      default:
        return "";
    }
  };

  const getTextClass = () => {
    switch (status) {
      case "success":
        return "text-green-800 dark:text-green-200";
      case "failure":
        return "text-red-800 dark:text-red-200";
      case "validating":
        return "text-blue-800 dark:text-blue-200";
      default:
        return "";
    }
  };

  const content = (
    <m.div
      initial={{ opacity: 0, y: asToast ? -20 : 0, scale: asToast ? 0.95 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: asToast ? -20 : 0, scale: asToast ? 0.95 : 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`
        border rounded-lg p-4 shadow-sm
        ${getBackgroundClass()}
        ${asToast ? "min-w-[300px] max-w-md" : "w-full"}
        ${className}
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${getTextClass()}`}>
            {getMessage()}
          </p>

          {/* Show hint for failures */}
          {status === "failure" && hint && (
            <div className="mt-2">
              {!showHint ? (
                <button
                  onClick={() => setShowHint(true)}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span>Show hint</span>
                </button>
              ) : (
                <m.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.2 }}
                  className="flex items-start gap-2 p-2 mt-1 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded"
                >
                  <Lightbulb className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-800 dark:text-yellow-200">
                    {hint}
                  </p>
                </m.div>
              )}
            </div>
          )}
        </div>

        {/* Close button for toast */}
        {asToast && onDismiss && (
          <button
            onClick={() => {
              setIsVisible(false);
              onDismiss();
            }}
            className="flex-shrink-0 text-text-muted hover:text-text-secondary transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </m.div>
  );

  if (asToast) {
    return (
      <LazyMotion features={domAnimation}>
        <AnimatePresence>
          {isVisible && (
            <div className="fixed top-4 right-4 z-[9999]">{content}</div>
          )}
        </AnimatePresence>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>{isVisible && content}</AnimatePresence>
    </LazyMotion>
  );
};

export default ValidationFeedback;
