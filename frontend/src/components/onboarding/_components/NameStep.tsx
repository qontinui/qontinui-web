import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WizardState } from "../types";

interface NameStepProps {
  wizardState: WizardState;
  updateState: (updates: Partial<WizardState>) => void;
}

const NAME_SUGGESTIONS = ["My First Bot", "Civ 6 Helper", "Test Automation"];

export function NameStep({ wizardState, updateState }: NameStepProps) {
  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 rounded-full border border-brand-primary/30 mb-4">
          <FileText className="w-8 h-8 text-brand-primary" />
        </div>
        <h2 className="text-2xl font-bold">Name Your Project</h2>
        <p className="text-text-muted">Give your automation a memorable name</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="fpw-project-name"
            className="text-sm font-medium text-text-secondary"
          >
            Project Name <span className="text-red-400">*</span>
          </label>
          <Input
            id="fpw-project-name"
            value={wizardState.projectName}
            onChange={(e) => updateState({ projectName: e.target.value })}
            placeholder="Enter project name..."
            className="bg-surface-raised border-border-default text-white placeholder:text-text-muted focus:border-brand-primary"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text-secondary">Suggestions</p>
          <div className="flex flex-wrap gap-2">
            {NAME_SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                onClick={() => updateState({ projectName: suggestion })}
                className="border-border-default hover:border-brand-primary hover:text-brand-primary text-text-secondary"
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="fpw-project-description"
            className="text-sm font-medium text-text-secondary"
          >
            Description{" "}
            <span className="text-text-muted text-xs">(optional)</span>
          </label>
          <Input
            id="fpw-project-description"
            value={wizardState.projectDescription}
            onChange={(e) =>
              updateState({ projectDescription: e.target.value })
            }
            placeholder="What will this automation do?"
            className="bg-surface-raised border-border-default text-white placeholder:text-text-muted focus:border-brand-primary"
          />
        </div>
      </div>
    </div>
  );
}
