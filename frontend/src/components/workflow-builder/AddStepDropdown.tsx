"use client";

import React, { useState, useCallback } from "react";
import {
  Terminal,
  MessageSquare,
  TestTube2,
  Monitor,
  AlertTriangle,
  CheckCircle2,
  Workflow,
  Activity,
  Bot,
  Globe,
  ScanSearch,
  AlignLeft,
  FileType,
  CheckSquare,
  HeartPulse,
  Camera,
  Rocket,
  Puzzle,
  GitBranch,
  ShieldCheck,
  Pointer,
  GitCompareArrows,
  Compass,
  Share2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PHASE_INFO,
  type UnifiedStep,
  type WorkflowPhase,
} from "@/types/unified-workflow";
import { SkillCatalogConcrete } from "@qontinui/workflow-ui/components";
import { SkillSharingPanel } from "./SkillSharingPanel";

// =============================================================================
// Icon Resolver
// =============================================================================

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  "message-square": MessageSquare,
  "test-tube-2": TestTube2,
  monitor: Monitor,
  "alert-triangle": AlertTriangle,
  "check-circle": CheckCircle2,
  workflow: Workflow,
  activity: Activity,
  bot: Bot,
  globe: Globe,
  "scan-search": ScanSearch,
  "align-left": AlignLeft,
  "file-type": FileType,
  "check-square": CheckSquare,
  "heart-pulse": HeartPulse,
  camera: Camera,
  rocket: Rocket,
  puzzle: Puzzle,
  "git-branch": GitBranch,
  "shield-check": ShieldCheck,
  pointer: Pointer,
  "git-compare-arrows": GitCompareArrows,
  compass: Compass,
};

function resolveIcon(
  iconId: string
): React.ComponentType<{ className?: string }> {
  return ICON_MAP[iconId] ?? Activity;
}

// =============================================================================
// Component
// =============================================================================

interface AddStepDropdownProps {
  phase: WorkflowPhase;
  isOpen: boolean;
  onClose: () => void;
  onAddStep: (step: UnifiedStep, phase: WorkflowPhase) => void;
}

export function AddStepDropdown({
  phase,
  isOpen,
  onClose,
  onAddStep,
}: AddStepDropdownProps) {
  const [showSharingPanel, setShowSharingPanel] = useState(false);
  const phaseInfo = PHASE_INFO[phase];

  // Handle skill catalog adding steps
  const handleAddSteps = useCallback(
    (steps: UnifiedStep[], targetPhase: WorkflowPhase) => {
      for (const step of steps) {
        onAddStep(step, targetPhase);
      }
      onClose();
    },
    [onAddStep, onClose]
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Add Step to {phaseInfo.label}</DialogTitle>
            <button
              className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
              onClick={() => setShowSharingPanel(true)}
              title="Manage skill sharing with your organization"
            >
              <Share2 className="w-3.5 h-3.5" />
              Sharing
            </button>
          </div>
        </DialogHeader>

        <SkillSharingPanel
          isOpen={showSharingPanel}
          onClose={() => setShowSharingPanel(false)}
        />

        <ScrollArea className="max-h-[60vh]">
          <SkillCatalogConcrete
            phase={phase}
            isOpen={true}
            onAddSteps={handleAddSteps}
            onClose={onClose}
            resolveIcon={resolveIcon}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
