"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import type { TryItConfig } from "@/types/tutorial";

/**
 * TryItButtonProps
 *
 * Configuration for the TryItButton component
 */
interface TryItButtonProps {
  /** Configuration for the Try It exercise */
  config: TryItConfig;

  /** Optional callback when user completes the exercise */
  onComplete?: (result: unknown) => void;

  /** Optional CSS class name for the button container */
  className?: string;
}

/**
 * TryItButton Component
 *
 * Interactive button that triggers "Try It" moments in tutorials.
 * Features:
 * - Large, prominent cyan button (Qontinui brand color)
 * - Dynamic state management (default, loading, completed)
 * - Modal dialog for interactive exercise
 * - Hint display for user guidance
 * - Success toast notification on completion
 * - Preloaded data support for components
 *
 * @example
 * ```tsx
 * <TryItButton
 *   config={{
 *     type: 'upload-screenshots',
 *     component: 'ScreenshotUploader',
 *     hints: ['Start by clicking the upload button'],
 *   }}
 *   onComplete={(result) => console.log('User completed:', result)}
 * />
 * ```
 */
export function TryItButton({
  config,
  onComplete,
  className = "",
}: TryItButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isTryItOpen, setIsTryItOpen] = useState(false);
  const [currentHintIndex, setCurrentHintIndex] = useState(0);

  /**
   * Handle Try It button click
   * Opens the interactive exercise dialog
   */
  const handleTryIt = () => {
    setIsTryItOpen(true);
    setIsLoading(true);

    // Simulate component loading
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  };

  /**
   * Handle exercise completion
   * Called when user finishes the Try It exercise
   */
  const handleExerciseComplete = (result: unknown) => {
    setIsCompleted(true);
    setIsTryItOpen(false);

    // Show success toast
    toast.success("Exercise Completed!", {
      description: `You've successfully completed the "${config.type}" exercise.`,
    });

    // Call parent callback
    if (onComplete) {
      onComplete(result);
    }
  };

  /**
   * Get button text based on current state
   */
  const getButtonText = (): string => {
    if (isLoading) return "Loading...";
    if (isCompleted) return "Completed";
    return "Try It Yourself";
  };

  /**
   * Handle moving to next hint
   */
  const handleNextHint = () => {
    if (config.hints && currentHintIndex < config.hints.length - 1) {
      setCurrentHintIndex((prev) => prev + 1);
    }
  };

  /**
   * Handle moving to previous hint
   */
  const handlePreviousHint = () => {
    if (currentHintIndex > 0) {
      setCurrentHintIndex((prev) => prev - 1);
    }
  };

  /**
   * Render the appropriate component based on try it type
   * This serves as a placeholder for actual component rendering
   */
  const renderTryItComponent = () => {
    const preloadedData = config.preloadedData || {};

    // This is a framework for rendering different component types
    // Each type would render the appropriate interactive component
    return (
      <div className="space-y-6">
        {/* Component would be rendered here based on config.type */}
        <div className="text-center py-12">
          <h3 className="text-lg font-semibold text-text-primary mb-4">
            {config.type === "upload-screenshots" && "Upload Your Screenshots"}
            {config.type === "identify-element" && "Identify the Element"}
            {config.type === "create-action" && "Create an Action"}
            {config.type === "configure-automation" && "Configure Automation"}
            {config.type === "test-automation" && "Test Your Automation"}
            {config.type === "debug-pattern" && "Debug the Pattern"}
            {config.type === "optimize-automation" &&
              "Optimize Your Automation"}
            {config.type === "custom" && "Complete This Exercise"}
          </h3>

          <p className="text-text-muted mb-8">
            Interactive component for:{" "}
            <code className="bg-surface-raised px-2 py-1 rounded text-sm">
              {config.component}
            </code>
          </p>

          {/* Show preloaded data if available */}
          {Object.keys(preloadedData).length > 0 && (
            <div className="bg-surface-canvas rounded-lg p-4 mb-8 text-left text-sm">
              <p className="font-semibold text-text-primary mb-2">
                Preloaded Data:
              </p>
              <pre className="text-xs text-text-muted overflow-auto">
                {JSON.stringify(preloadedData, null, 2)}
              </pre>
            </div>
          )}

          {/* Success Criteria */}
          {config.successCriteria && (
            <div className="bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 rounded-lg p-4 text-left mb-8">
              <p className="font-semibold text-cyan-900 dark:text-cyan-100 mb-2">
                Success Criteria:
              </p>
              <p className="text-cyan-800 dark:text-cyan-200">
                {config.successCriteria.description}
              </p>
            </div>
          )}

          {/* Completion Button */}
          <Button
            size="lg"
            onClick={() => handleExerciseComplete({ completed: true })}
            className="bg-cyan-500 hover:bg-cyan-600 text-white"
          >
            Complete Exercise
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Main Try It Button */}
      <Button
        size="lg"
        onClick={handleTryIt}
        disabled={isLoading || isCompleted}
        className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold h-12 transition-colors duration-200"
      >
        <div className="flex items-center justify-center gap-2">
          {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          {isCompleted && (
            <>
              <Check className="h-5 w-5" />
              <span className="text-green-400">✓</span>
            </>
          )}
          <span>{getButtonText()}</span>
        </div>
      </Button>

      {/* Hints Section */}
      {config.hints && config.hints.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
              💡
            </div>
            <div className="flex-1">
              <p className="font-semibold text-amber-900 dark:text-amber-100 mb-2">
                Hint:
              </p>
              <p className="text-amber-800 dark:text-amber-200 text-sm mb-3">
                {config.hints[currentHintIndex]}
              </p>

              {/* Hint Navigation */}
              {config.hints.length > 1 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <button
                    onClick={handlePreviousHint}
                    disabled={currentHintIndex === 0}
                    className="px-2 py-1 rounded bg-amber-200 dark:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
                  >
                    ← Previous
                  </button>
                  <span className="font-medium">
                    {currentHintIndex + 1} / {config.hints.length}
                  </span>
                  <button
                    onClick={handleNextHint}
                    disabled={currentHintIndex === config.hints.length - 1}
                    className="px-2 py-1 rounded bg-amber-200 dark:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Try It Dialog */}
      <Dialog open={isTryItOpen} onOpenChange={setIsTryItOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-text-primary">
              {config.type === "upload-screenshots" &&
                "Upload Your Screenshots"}
              {config.type === "identify-element" && "Identify the Element"}
              {config.type === "create-action" && "Create an Action"}
              {config.type === "configure-automation" && "Configure Automation"}
              {config.type === "test-automation" && "Test Your Automation"}
              {config.type === "debug-pattern" && "Debug the Pattern"}
              {config.type === "optimize-automation" &&
                "Optimize Your Automation"}
              {config.type === "custom" && "Interactive Exercise"}
            </DialogTitle>
            {config.successCriteria && (
              <DialogDescription className="mt-2">
                {config.successCriteria.description}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* Content */}
          <div className="py-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
              </div>
            ) : (
              renderTryItComponent()
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { TryItButtonProps };
