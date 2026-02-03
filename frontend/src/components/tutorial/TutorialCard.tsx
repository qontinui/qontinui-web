/**
 * TutorialCard Component
 *
 * Card display for tutorial listings.
 * Shows tutorial info with completion status and action buttons.
 */

"use client";

import React from "react";
import {
  BookOpen,
  CheckCircle,
  Clock,
  PlayCircle,
  RotateCcw,
  BarChart3,
} from "lucide-react";
import type { Tutorial, DifficultyLevel } from "@/types/tutorial";

export interface TutorialCardProps {
  /** Tutorial to display */
  tutorial: Tutorial;
  /** Whether the tutorial has been completed */
  isCompleted?: boolean;
  /** Whether the tutorial is in progress */
  isInProgress?: boolean;
  /** Completion percentage (for in-progress tutorials) */
  completionPercentage?: number;
  /** Whether this is a featured tutorial */
  isFeatured?: boolean;
  /** Callback when Start/Resume button is clicked */
  onStart?: (tutorial: Tutorial) => void;
  /** Callback when Restart button is clicked */
  onRestart?: (tutorial: Tutorial) => void;
  /** Custom class name */
  className?: string;
}

const difficultyConfig: Record<
  DifficultyLevel,
  { label: string; className: string }
> = {
  beginner: {
    label: "Beginner",
    className: "tutorial-difficulty-badge beginner",
  },
  intermediate: {
    label: "Intermediate",
    className: "tutorial-difficulty-badge intermediate",
  },
  advanced: {
    label: "Advanced",
    className: "tutorial-difficulty-badge advanced",
  },
};

export const TutorialCard: React.FC<TutorialCardProps> = ({
  tutorial,
  isCompleted = false,
  isInProgress = false,
  completionPercentage = 0,
  isFeatured = false,
  onStart,
  onRestart,
  className = "",
}) => {
  const difficultyInfo = difficultyConfig[tutorial.difficulty];

  const handleStart = () => {
    onStart?.(tutorial);
  };

  const handleRestart = () => {
    onRestart?.(tutorial);
  };

  return (
    <div
      className={`
        tutorial-card
        ${isFeatured ? "featured" : ""}
        ${className}
      `}
    >
      {/* Header with icon and status */}
      <div className="flex items-start gap-3 mb-3">
        {/* Icon */}
        <div
          className={`
          flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
          ${
            isCompleted
              ? "bg-green-500/10 text-green-500"
              : "bg-primary/10 text-primary"
          }
        `}
        >
          {isCompleted ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <BookOpen className="w-5 h-5" />
          )}
        </div>

        {/* Title and badges */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text-primary dark:text-white truncate">
            {tutorial.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={difficultyInfo.className}>
              {difficultyInfo.label}
            </span>
            {isCompleted && (
              <span className="tutorial-status-badge completed">
                <CheckCircle className="w-3 h-3" />
                Completed
              </span>
            )}
            {isInProgress && !isCompleted && (
              <span className="tutorial-status-badge in-progress">
                <BarChart3 className="w-3 h-3" />
                {completionPercentage}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-text-secondary dark:text-text-secondary mb-3 line-clamp-2">
        {tutorial.description}
      </p>

      {/* Meta info */}
      <div className="flex items-center gap-4 text-xs text-text-muted mb-4">
        <div className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          <span>{tutorial.duration}</span>
        </div>
        <div className="flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5" />
          <span>{tutorial.steps.length} steps</span>
        </div>
        {tutorial.category && (
          <span className="text-text-muted">{tutorial.category}</span>
        )}
      </div>

      {/* Progress bar (for in-progress tutorials) */}
      {isInProgress && !isCompleted && (
        <div className="mb-4">
          <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {isInProgress && !isCompleted ? (
          <>
            <button
              onClick={handleStart}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md transition-colors"
            >
              <PlayCircle className="w-4 h-4" />
              Resume
            </button>
            <button
              onClick={handleRestart}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded-md transition-colors"
              title="Restart tutorial"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </>
        ) : isCompleted ? (
          <button
            onClick={handleStart}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary border border-border-default hover:border-border-strong rounded-md transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Review Again
          </button>
        ) : (
          <button
            onClick={handleStart}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-md transition-colors"
          >
            <PlayCircle className="w-4 h-4" />
            Start Tutorial
          </button>
        )}
      </div>
    </div>
  );
};

export default TutorialCard;
