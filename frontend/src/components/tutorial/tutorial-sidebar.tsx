"use client";

import React from "react";
import { useTutorialStore, Tutorial } from "@/stores/tutorial-store";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";

interface TutorialSidebarProps {
  tutorial: Tutorial;
}

/**
 * TutorialSidebar Component
 *
 * Displays progress tracker showing all tutorial steps.
 * Features:
 * - Visual progress indicators (completed/current/upcoming)
 * - Quick navigation to any step
 * - Step titles and estimated time
 *
 * Takes up 1/3 of the dialog width on the left side.
 */
export function TutorialSidebar({ tutorial }: TutorialSidebarProps) {
  const currentStepIndex = useTutorialStore((state) => state.currentStepIndex);
  const goToStep = useTutorialStore((state) => state.goToStep);

  return (
    <div className="space-y-2 px-4">
      {/* Header */}
      <div className="mb-4">
        <h3 className="font-semibold text-text-primary dark:text-white mb-1">
          Tutorial Steps
        </h3>
        <p className="text-sm text-text-muted dark:text-text-muted">
          {currentStepIndex + 1} of {tutorial.steps.length}
        </p>
      </div>

      {/* Steps list */}
      <div className="space-y-1">
        {tutorial.steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isUpcoming = index > currentStepIndex;

          return (
            <button
              key={step.id}
              onClick={() => goToStep(index)}
              className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left ${
                isCurrent
                  ? "bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800"
                  : isCompleted
                    ? "hover:bg-surface-raised dark:hover:bg-surface-raised"
                    : "hover:bg-surface-raised dark:hover:bg-surface-raised"
              }`}
              disabled={isUpcoming}
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* Icon */}
              <div className="flex-shrink-0 mt-1">
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : isCurrent ? (
                  <Circle className="h-5 w-5 text-cyan-600 dark:text-cyan-400 fill-cyan-600 dark:fill-cyan-400" />
                ) : (
                  <Circle className="h-5 w-5 text-text-muted dark:text-text-muted" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p
                  className={`font-medium text-sm truncate ${
                    isCurrent
                      ? "text-cyan-900 dark:text-cyan-100"
                      : "text-text-primary dark:text-text-secondary"
                  }`}
                >
                  {step.title}
                </p>
                {step.action && (
                  <p className="text-xs text-text-muted dark:text-text-muted truncate mt-0.5">
                    {step.action}
                  </p>
                )}
              </div>

              {/* Arrow for current step */}
              {isCurrent && (
                <ChevronRight className="h-4 w-4 text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer info */}
      {tutorial.estimatedTime && (
        <div className="mt-6 pt-4 border-t border-border-subtle dark:border-border-default">
          <p className="text-xs text-text-muted dark:text-text-muted">
            <span className="font-medium">Estimated time:</span>{" "}
            {tutorial.estimatedTime} min
          </p>
        </div>
      )}
    </div>
  );
}
