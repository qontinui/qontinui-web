"use client";

import React from "react";
import { Plus } from "lucide-react";
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
  const stepTypes = (dynamicStepTypes ?? STEP_TYPES)[phase];
  const phaseInfo = PHASE_INFO[phase];

  const handleSelectStep = (type: string) => {
    const step = createDefaultStep(type as UnifiedStep["type"], phase);
    onAddStep(step, phase);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Step to {phaseInfo.label}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-1 p-1">
            {stepTypes.map((item) => (
              <button
                key={item.type}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                onClick={() => handleSelectStep(item.type)}
              >
                <Plus className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="text-sm text-zinc-200">{item.label}</div>
                  <div className="text-xs text-zinc-500">
                    {item.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
