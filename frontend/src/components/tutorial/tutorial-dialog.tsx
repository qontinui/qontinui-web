"use client"

import React, { useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useTutorialStore } from "@/stores/tutorial-store"
import { TutorialSidebar } from "./tutorial-sidebar"
import { StepRenderer } from "./step-renderer"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

/**
 * TutorialDialog Component
 *
 * Main tutorial dialog that displays interactive tutorials in a large modal.
 * Features:
 * - Two-column layout (sidebar + content)
 * - Progress tracking with visual indicator
 * - Keyboard navigation (arrow keys, Escape)
 * - Previous/Next navigation buttons
 * - Completion percentage display
 *
 * Uses the tutorial store for all state management.
 */
export function TutorialDialog() {
  // Get state from tutorial store
  const isOpen = useTutorialStore((state) => state.isOpen)
  const currentTutorial = useTutorialStore((state) => state.currentTutorial)
  const currentStepIndex = useTutorialStore((state) => state.currentStepIndex)

  // Get actions from tutorial store
  const closeTutorial = useTutorialStore((state) => state.closeTutorial)
  const nextStep = useTutorialStore((state) => state.nextStep)
  const previousStep = useTutorialStore((state) => state.previousStep)
  const isFirstStep = useTutorialStore((state) => state.isFirstStep())
  const isLastStep = useTutorialStore((state) => state.isLastStep())
  const completionPercentage = useTutorialStore(
    (state) => state.getCompletionPercentage()
  )
  const completeTutorial = useTutorialStore((state) => state.completeTutorial)

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape to close
      if (event.key === "Escape") {
        closeTutorial()
        return
      }

      // Arrow right to next step
      if (event.key === "ArrowRight") {
        event.preventDefault()
        nextStep()
        return
      }

      // Arrow left to previous step
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        previousStep()
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, nextStep, previousStep, closeTutorial])

  if (!currentTutorial) return null

  return (
    <Dialog open={isOpen} onOpenChange={closeTutorial}>
      <DialogContent
        className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        {/* Header with title and progress */}
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                {currentTutorial.title}
              </DialogTitle>
              {currentTutorial.description && (
                <DialogDescription className="mt-1">
                  {currentTutorial.description}
                </DialogDescription>
              )}
            </div>
            <button
              onClick={closeTutorial}
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close tutorial"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Step {currentStepIndex + 1} of {currentTutorial.steps.length}
              </span>
              <span className="font-semibold bg-gradient-to-r from-cyan-600 to-green-600 bg-clip-text text-transparent">
                {completionPercentage}% Complete
              </span>
            </div>
            <Progress value={completionPercentage} max={100} className="h-2" />
          </div>
        </DialogHeader>

        {/* Main content area - two column layout */}
        <div className="flex-1 flex gap-6 overflow-hidden py-6 px-0">
          {/* Left sidebar - progress tracker (1/3 width) */}
          <div className="w-1/3 flex-shrink-0 overflow-y-auto">
            <TutorialSidebar tutorial={currentTutorial} />
          </div>

          {/* Right content - step renderer (2/3 width) */}
          <div className="flex-1 overflow-y-auto pr-2">
            <StepRenderer currentTutorial={currentTutorial} />
          </div>
        </div>

        {/* Footer with navigation buttons */}
        <DialogFooter className="border-t pt-4 flex justify-between gap-2">
          {/* Left buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={closeTutorial}
              className="gap-2"
            >
              Skip Tutorial
            </Button>
          </div>

          {/* Right buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={previousStep}
              disabled={isFirstStep}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              onClick={() => {
                if (isLastStep) {
                  completeTutorial()
                } else {
                  nextStep()
                }
              }}
              className="gap-2 bg-gradient-to-r from-cyan-600 to-green-600 hover:from-cyan-700 hover:to-green-700"
            >
              {isLastStep ? (
                <>
                  Finish
                  <ChevronRight className="h-4 w-4" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
