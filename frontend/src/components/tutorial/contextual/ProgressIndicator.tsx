/**
 * ProgressIndicator Component
 *
 * Displays tutorial progress as a compact progress bar with step counter.
 * Shows current step, total steps, and completion percentage.
 */

import React from "react";
import { m, LazyMotion, domAnimation } from "framer-motion";

export interface ProgressIndicatorProps {
  /** Current step number (1-indexed) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Display variant: linear bar or circular */
  variant?: "linear" | "circular";
  /** Size for the progress indicator */
  size?: "sm" | "md" | "lg";
  /** Show percentage label */
  showPercentage?: boolean;
  /** Custom class name */
  className?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps,
  variant = "linear",
  size = "md",
  showPercentage = true,
  className = "",
}) => {
  const percentage = Math.round((currentStep / totalSteps) * 100);

  // Size configurations
  const sizeClasses = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
  };

  const textSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  const circularSizes = {
    sm: { size: 40, strokeWidth: 3 },
    md: { size: 60, strokeWidth: 4 },
    lg: { size: 80, strokeWidth: 5 },
  };

  if (variant === "circular") {
    const { size: circleSize, strokeWidth } = circularSizes[size];
    const radius = (circleSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    return (
      <LazyMotion features={domAnimation}>
        <div className={`inline-flex items-center justify-center ${className}`}>
          <div
            className="relative"
            style={{ width: circleSize, height: circleSize }}
          >
            <svg
              width={circleSize}
              height={circleSize}
              className="transform -rotate-90"
            >
              {/* Background circle */}
              <circle
                cx={circleSize / 2}
                cy={circleSize / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                className="text-border-subtle dark:text-surface-raised"
              />
              {/* Progress circle */}
              <m.circle
                cx={circleSize / 2}
                cy={circleSize / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="text-blue-600 dark:text-blue-400"
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
              />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={`font-semibold text-text-primary dark:text-text-primary ${textSizeClasses[size]}`}
              >
                {currentStep}/{totalSteps}
              </span>
              {showPercentage && (
                <span className="text-xs text-text-muted dark:text-text-muted">
                  {percentage}%
                </span>
              )}
            </div>
          </div>
        </div>
      </LazyMotion>
    );
  }

  // Linear variant
  return (
    <LazyMotion features={domAnimation}>
      <div className={`w-full ${className}`}>
        <div className="flex items-center justify-between mb-1">
          <span
            className={`font-medium text-text-secondary dark:text-text-secondary ${textSizeClasses[size]}`}
          >
            Step {currentStep} of {totalSteps}
          </span>
          {showPercentage && (
            <span
              className={`font-semibold text-blue-600 dark:text-blue-400 ${textSizeClasses[size]}`}
            >
              {percentage}%
            </span>
          )}
        </div>
        <div
          className={`w-full bg-surface-raised dark:bg-surface-raised rounded-full overflow-hidden ${sizeClasses[size]}`}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Tutorial progress: ${percentage}% complete`}
        >
          <m.div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </div>
      </div>
    </LazyMotion>
  );
};

export default ProgressIndicator;
