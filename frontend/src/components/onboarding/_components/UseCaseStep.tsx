import { Target, Bot, TestTube, Briefcase, Compass } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { WizardState } from "../types";

interface UseCaseStepProps {
  wizardState: WizardState;
  updateState: (updates: Partial<WizardState>) => void;
}

const USE_CASE_OPTIONS = [
  {
    value: "development" as const,
    label: "AI Development",
    description: "Orchestrate AI coding sessions with verification loops",
    icon: Bot,
  },
  {
    value: "testing" as const,
    label: "Testing/QA",
    description: "Automated testing and quality assurance",
    icon: TestTube,
  },
  {
    value: "productivity" as const,
    label: "Productivity/Business",
    description: "Streamline business processes and workflows",
    icon: Briefcase,
  },
  {
    value: "exploring" as const,
    label: "Just Exploring",
    description: "Learning and experimenting with the platform",
    icon: Compass,
  },
];

export function UseCaseStep({ wizardState, updateState }: UseCaseStepProps) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 rounded-full border border-brand-primary/30 mb-4">
          <Target className="w-8 h-8 text-brand-primary" />
        </div>
        <h2 className="text-2xl font-bold">What Will You Automate?</h2>
        <p className="text-text-muted">Help us customize your experience</p>
      </div>

      <div className="bg-surface-raised/30 border border-border-subtle rounded-lg p-4 mb-4">
        <p className="text-sm text-text-muted">
          Understanding your use case helps us provide better guidance,
          templates, and features tailored to your needs.
        </p>
      </div>

      <RadioGroup
        value={wizardState.useCase}
        onValueChange={(value) =>
          updateState({ useCase: value as WizardState["useCase"] })
        }
        className="space-y-3"
      >
        {USE_CASE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = wizardState.useCase === option.value;

          return (
            <label htmlFor={`usecase-${option.value}`}
              key={option.value}
              className={cn(
                "flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all duration-300",
                isSelected
                  ? "bg-brand-primary/10 border-brand-primary shadow-[0_0_20px_rgba(0,217,255,0.1)]"
                  : "bg-surface-raised/50 border-border-subtle hover:border-border-default"
              )}
            >
              <RadioGroupItem id={`usecase-${option.value}`} value={option.value} className="mt-1" />
              <div className="flex items-start gap-3 flex-1">
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    isSelected ? "bg-brand-primary/20" : "bg-surface-raised"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-5 h-5",
                      isSelected ? "text-brand-primary" : "text-text-muted"
                    )}
                  />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">{option.label}</div>
                  <div className="text-sm text-text-muted">
                    {option.description}
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
