import { Layout, Bot, MousePointer, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardState, TemplateOption } from "../types";

interface TemplateStepProps {
  wizardState: WizardState;
  updateState: (updates: Partial<WizardState>) => void;
}

const templates: TemplateOption[] = [
  {
    id: "blank",
    name: "Blank Project",
    description: "Start from scratch with an empty canvas",
    icon: Layout,
  },
  {
    id: "civ6",
    name: "Civ 6 Unit Manager",
    description: "Pre-configured for Civilization VI automation",
    icon: Bot,
  },
  {
    id: "clicker",
    name: "Simple Clicker",
    description: "Basic click automation example",
    icon: MousePointer,
  },
];

export { templates };

export function TemplateStep({ wizardState, updateState }: TemplateStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 rounded-full border border-brand-primary/30 mb-4">
          <Layout className="w-8 h-8 text-brand-primary" />
        </div>
        <h2 className="text-2xl font-bold">Choose a Template</h2>
        <p className="text-text-muted">
          Start with a template or build from scratch
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-3xl mx-auto">
        {templates.map((template) => {
          const Icon = template.icon;
          const isSelected = wizardState.selectedTemplate === template.id;

          return (
            <button
              key={template.id}
              onClick={() => updateState({ selectedTemplate: template.id })}
              className={cn(
                "p-6 rounded-lg border-2 transition-all duration-300 text-left hover:shadow-lg",
                isSelected
                  ? "bg-brand-primary/10 border-brand-primary shadow-[0_0_20px_rgba(0,217,255,0.2)]"
                  : "bg-surface-raised/50 border-border-subtle hover:border-border-default"
              )}
            >
              <div className="space-y-3">
                <div
                  className={cn(
                    "inline-flex items-center justify-center w-12 h-12 rounded-lg",
                    isSelected
                      ? "bg-brand-primary/20 border border-brand-primary/30"
                      : "bg-surface-raised border border-border-default"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-6 h-6",
                      isSelected ? "text-brand-primary" : "text-text-muted"
                    )}
                  />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{template.name}</h3>
                  <p className="text-sm text-text-muted">
                    {template.description}
                  </p>
                </div>
                {isSelected && (
                  <div className="flex items-center gap-2 text-brand-primary text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Selected</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
