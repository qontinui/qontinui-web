import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Rocket } from "lucide-react";
import { TOTAL_STEPS } from "../types";

interface WizardFooterProps {
  currentStep: number;
  isCreating: boolean;
  canAdvance: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onOpenProject: () => void;
  onWatchTutorial: () => void;
}

export function WizardFooter({
  currentStep,
  isCreating,
  canAdvance,
  onNext,
  onBack,
  onSkip,
  onOpenProject,
  onWatchTutorial,
}: WizardFooterProps) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
      <div>
        {currentStep > 1 && currentStep < TOTAL_STEPS && (
          <Button
            variant="outline"
            onClick={onBack}
            className="border-border-default hover:border-brand-primary hover:text-brand-primary text-text-secondary"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {currentStep < TOTAL_STEPS && (
          <Button
            variant="ghost"
            onClick={onSkip}
            className="text-text-muted hover:text-white"
          >
            Skip Wizard
          </Button>
        )}

        {currentStep < TOTAL_STEPS ? (
          <Button
            onClick={onNext}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
            disabled={!canAdvance}
          >
            {currentStep === 1 ? "Get Started" : "Next"}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onWatchTutorial}
              className="border-brand-secondary text-brand-secondary hover:bg-brand-secondary/10"
              disabled={isCreating}
            >
              Watch Tutorial First
            </Button>
            <Button
              onClick={onOpenProject}
              className="bg-gradient-to-r from-brand-primary to-brand-success hover:opacity-90 text-black font-medium"
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4 mr-2" />
                  Open Project
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
