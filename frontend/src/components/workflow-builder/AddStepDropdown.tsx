"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Terminal,
  Monitor,
  Bot,
  Sparkles,
  ExternalLink,
  TestTube2,
  CheckCircle2,
  Globe,
  Zap,
  Compass,
  ArrowRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  UnifiedStep,
  WorkflowPhase,
  StepTypeInfo,
} from "@/types/unified-workflow";
import {
  STEP_TYPES,
  PHASE_INFO,
  createDefaultStep,
} from "@/types/unified-workflow";
import {
  getTemplatesForPhase,
  TEMPLATE_CATEGORIES,
} from "@/lib/step-templates";
import type { StepTemplate, TemplateCategory } from "@/lib/step-templates";

// Icon mapping for step types
const TYPE_ICONS: Record<string, React.ElementType> = {
  command: Terminal,
  ui_bridge: Monitor,
  prompt: Bot,
};

// Icon mapping for template categories
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  TestTube2,
  CheckCircle2,
  Terminal,
  Monitor,
  Bot,
  Globe,
  Zap,
  Compass,
};

interface AddStepDropdownProps {
  phase: WorkflowPhase;
  isOpen: boolean;
  onClose: () => void;
  onAddStep: (step: UnifiedStep, phase: WorkflowPhase) => void;
  /** Dynamic step types fetched from backend. Falls back to static STEP_TYPES. */
  dynamicStepTypes?: Record<WorkflowPhase, StepTypeInfo[]>;
}

export function AddStepDropdown({
  phase,
  isOpen,
  onClose,
  onAddStep,
  dynamicStepTypes,
}: AddStepDropdownProps) {
  const router = useRouter();
  const stepTypes = (dynamicStepTypes ?? STEP_TYPES)[phase];
  const phaseInfo = PHASE_INFO[phase];
  const templates = getTemplatesForPhase(phase);

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, StepTemplate[]> = {};
    for (const t of templates) {
      (groups[t.category] ??= []).push(t);
    }
    return groups;
  }, [templates]);

  const handleSelectStep = (type: string) => {
    const step = createDefaultStep(type as UnifiedStep["type"], phase);
    onAddStep(step, phase);
    onClose();
  };

  const handleSelectTemplate = (template: StepTemplate) => {
    const step = template.createStep(phase);
    onAddStep(step, phase);
    onClose();
  };

  // Group step types: scripted (command, ui_bridge) vs AI-driven (prompt)
  const scriptedTypes = stepTypes.filter(
    (t) => t.type === "command" || t.type === "ui_bridge"
  );
  const aiTypes = stepTypes.filter((t) => t.type === "prompt");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Step to {phaseInfo.label}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-1 space-y-3">
            {/* Start from scratch */}
            <div>
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                Start from scratch
              </div>

              {scriptedTypes.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 pt-1 text-[10px] text-zinc-600">
                    Scripted
                  </div>
                  {scriptedTypes.map((item) => {
                    const Icon = TYPE_ICONS[item.type] ?? Plus;
                    return (
                      <button
                        key={item.type}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                        onClick={() => handleSelectStep(item.type)}
                      >
                        <Icon className="w-4 h-4 text-zinc-400" />
                        <div>
                          <div className="text-sm text-zinc-200">
                            {item.label}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {item.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {aiTypes.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 pt-1 text-[10px] text-zinc-600">
                    AI-Driven
                  </div>
                  {aiTypes.map((item) => (
                    <button
                      key={item.type}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                      onClick={() => handleSelectStep(item.type)}
                    >
                      <Bot className="w-4 h-4 text-zinc-400" />
                      <div>
                        <div className="text-sm text-zinc-200">
                          {item.label}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {item.description}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* From template */}
            {templates.length > 0 && (
              <div>
                <div className="border-t border-zinc-800 my-2" />
                <div className="px-2 pb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  <Sparkles className="w-3 h-3" />
                  From template
                </div>
                <div className="space-y-2">
                  {Object.entries(groupedTemplates).map(
                    ([category, categoryTemplates]) => {
                      const meta =
                        TEMPLATE_CATEGORIES[category as TemplateCategory];
                      const CatIcon =
                        CATEGORY_ICONS[meta?.icon ?? ""] ?? Sparkles;
                      return (
                        <div key={category}>
                          <div className="px-2 pt-1 pb-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                            <CatIcon className="w-3 h-3" />
                            <span>{meta?.label ?? category}</span>
                          </div>
                          <div className="space-y-0.5">
                            {categoryTemplates.map((template) => (
                              <button
                                key={template.id}
                                className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-zinc-800 text-left transition-colors group"
                                onClick={() => handleSelectTemplate(template)}
                              >
                                <Plus className="w-3.5 h-3.5 text-zinc-500" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-zinc-300">
                                    {template.name}
                                  </div>
                                  <div className="text-[11px] text-zinc-600">
                                    {template.description}
                                  </div>
                                </div>
                                {template.builderPageUrl && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-all"
                                    title="Open in builder"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(template.builderPageUrl!);
                                      onClose();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.stopPropagation();
                                        router.push(template.builderPageUrl!);
                                        onClose();
                                      }
                                    }}
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>

                {/* Footer link */}
                <div className="border-t border-zinc-800 mt-2 pt-2">
                  <button
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-zinc-800 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    onClick={() => {
                      router.push("/build/templates");
                      onClose();
                    }}
                  >
                    View all in Step Builders
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
