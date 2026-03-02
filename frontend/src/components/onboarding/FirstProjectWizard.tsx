"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X } from "lucide-react";
import { TOTAL_STEPS, type FirstProjectWizardProps } from "./types";
import { useWizard } from "./_hooks/useWizard";
import { WelcomeStep } from "./_components/WelcomeStep";
import { NameStep } from "./_components/NameStep";
import { TemplateStep } from "./_components/TemplateStep";
import { UseCaseStep } from "./_components/UseCaseStep";
import { ReadyStep } from "./_components/ReadyStep";
import { WizardFooter } from "./_components/WizardFooter";

export function FirstProjectWizard({
  open,
  onOpenChange,
  onComplete,
}: FirstProjectWizardProps) {
  const {
    currentStep,
    wizardState,
    progressPercentage,
    isCreating,
    updateState,
    handleNext,
    handleBack,
    handleSkip,
    handleClose,
    handleOpenProject,
    handleWatchTutorial,
  } = useWizard(open, onOpenChange, onComplete);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas border-border-subtle text-white"
        showCloseButton={false}
      >
        {/* Header with Progress */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
                First Project Wizard
              </DialogTitle>
              <DialogDescription className="text-text-muted">
                Step {currentStep} of {TOTAL_STEPS}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="text-text-muted hover:text-white"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <Progress
              value={progressPercentage}
              className="h-2 bg-surface-raised"
            />
            <div className="flex justify-between text-xs text-text-muted">
              <span>Welcome</span>
              <span>Name</span>
              <span>Template</span>
              <span>Use Case</span>
              <span>Ready!</span>
            </div>
          </div>
        </div>

        {/* Step Content */}
        <div className="py-8 min-h-[400px]">
          {currentStep === 1 && <WelcomeStep />}
          {currentStep === 2 && (
            <NameStep wizardState={wizardState} updateState={updateState} />
          )}
          {currentStep === 3 && (
            <TemplateStep wizardState={wizardState} updateState={updateState} />
          )}
          {currentStep === 4 && (
            <UseCaseStep wizardState={wizardState} updateState={updateState} />
          )}
          {currentStep === 5 && <ReadyStep wizardState={wizardState} />}
        </div>

        {/* Footer Navigation */}
        <WizardFooter
          currentStep={currentStep}
          isCreating={isCreating}
          canAdvance={currentStep !== 2 || !!wizardState.projectName.trim()}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleSkip}
          onOpenProject={handleOpenProject}
          onWatchTutorial={handleWatchTutorial}
        />
      </DialogContent>
    </Dialog>
  );
}
