import { CheckCircle2, Sparkles } from "lucide-react";
import { templates } from "./TemplateStep";
import type { WizardState } from "../types";

interface ReadyStepProps {
  wizardState: WizardState;
}

export function ReadyStep({ wizardState }: ReadyStepProps) {
  return (
    <div className="space-y-6 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-brand-success/20 to-brand-primary/20 rounded-full border border-brand-success/30 mb-4">
        <CheckCircle2 className="w-10 h-10 text-brand-success" />
      </div>
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">Ready to Build!</h2>
        <p className="text-text-muted">
          Your automation project is configured and ready to go
        </p>
      </div>

      <div className="bg-surface-raised/50 border border-border-subtle rounded-lg p-6 max-w-xl mx-auto text-left">
        <h3 className="font-semibold mb-4 text-center">Project Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-start">
            <span className="text-text-muted">Name:</span>
            <span className="font-medium text-right">
              {wizardState.projectName || "My First Automation"}
            </span>
          </div>
          {wizardState.projectDescription && (
            <div className="flex justify-between items-start">
              <span className="text-text-muted">Description:</span>
              <span className="font-medium text-right max-w-xs">
                {wizardState.projectDescription}
              </span>
            </div>
          )}
          <div className="flex justify-between items-start">
            <span className="text-text-muted">Template:</span>
            <span className="font-medium">
              {
                templates.find((t) => t.id === wizardState.selectedTemplate)
                  ?.name
              }
            </span>
          </div>
          <div className="flex justify-between items-start">
            <span className="text-text-muted">Use Case:</span>
            <span className="font-medium capitalize">
              {wizardState.useCase}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-brand-primary/10 to-brand-secondary/10 border border-brand-primary/30 rounded-lg p-6 max-w-xl mx-auto text-left">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-secondary" />
          Quick Tips for Getting Started
        </h3>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-brand-primary mt-1">&bull;</span>
            <span>
              Right-click on the canvas to add states to your workflow
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-brand-primary mt-1">&bull;</span>
            <span>
              Select a state to configure actions like clicking or typing
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-brand-primary mt-1">&bull;</span>
            <span>Upload screenshots for image recognition automation</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-brand-primary mt-1">&bull;</span>
            <span>Save your work frequently and export when ready</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
