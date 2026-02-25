"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Loader2, WifiOff, Check } from "lucide-react";
import { toast } from "sonner";
import {
  useUnifiedWorkflows,
  getWorkflow,
  updateWorkflow,
  createWorkflow,
} from "@/lib/api/unified-workflows";
import type { UnifiedStep, WorkflowPhase } from "@/types/unified-workflow";
import {
  generateStepId,
  canStepExistInPhase,
  PHASE_INFO,
} from "@/types/unified-workflow";

interface AddToWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stepData: Partial<UnifiedStep>;
}

const PHASES: WorkflowPhase[] = [
  "setup",
  "verification",
  "agentic",
  "completion",
];

const PHASE_COLORS: Record<WorkflowPhase, string> = {
  setup: "border-blue-500/50 text-blue-400 bg-blue-500/10",
  verification: "border-green-500/50 text-green-400 bg-green-500/10",
  agentic: "border-amber-500/50 text-amber-400 bg-amber-500/10",
  completion: "border-purple-500/50 text-purple-400 bg-purple-500/10",
};

export function AddToWorkflowDialog({
  open,
  onOpenChange,
  stepData,
}: AddToWorkflowDialogProps) {
  const {
    data: workflows,
    isLoading,
    isOffline,
    refetch,
  } = useUnifiedWorkflows();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [selectedPhase, setSelectedPhase] = useState<WorkflowPhase | null>(
    null
  );
  const [isAdding, setIsAdding] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedWorkflowId(null);
      setSelectedPhase(null);
      setIsAdding(false);
      setIsCreating(false);
    }
  }, [open]);

  const stepType = (stepData.type ?? "command") as UnifiedStep["type"];

  const validPhases = useMemo(
    () => PHASES.filter((p) => canStepExistInPhase(stepType, p)),
    [stepType]
  );

  // Auto-select first valid phase
  useEffect(() => {
    if (open && validPhases.length > 0 && !selectedPhase) {
      setSelectedPhase(validPhases[0] ?? null);
    }
  }, [open, validPhases, selectedPhase]);

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.description?.toLowerCase().includes(q)
    );
  }, [workflows, searchQuery]);

  const handleCreateWorkflow = async () => {
    setIsCreating(true);
    try {
      const workflow = await createWorkflow({
        name: "New Workflow",
        description: "",
        setup_steps: [],
        verification_steps: [],
        agentic_steps: [],
        completion_steps: [],
        category: "general",
        tags: [],
      });
      await refetch();
      setSelectedWorkflowId(workflow.id);
      toast.success(`Created "${workflow.name}"`);
    } catch (err) {
      toast.error(
        `Failed to create workflow: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddStep = async () => {
    if (!selectedWorkflowId || !selectedPhase) return;

    setIsAdding(true);
    try {
      const workflow = await getWorkflow(selectedWorkflowId);
      const phaseKey = `${selectedPhase}_steps` as `${WorkflowPhase}_steps`;

      const newStep = {
        ...stepData,
        id: generateStepId(),
        phase: selectedPhase,
      };

      const existingSteps = (workflow[phaseKey] as UnifiedStep[]) ?? [];
      const updatedSteps = [...existingSteps, newStep];

      await updateWorkflow(selectedWorkflowId, {
        [phaseKey]: updatedSteps,
      });

      const phaseLabel = PHASE_INFO[selectedPhase].label;
      toast.success(`Added step to "${workflow.name}" \u2192 ${phaseLabel}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        `Failed to add step: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to Workflow</DialogTitle>
        </DialogHeader>

        {isOffline ? (
          <div className="text-center py-8">
            <WifiOff className="w-10 h-10 mx-auto text-text-muted mb-3" />
            <p className="text-sm text-text-muted">
              Runner is offline. Start the runner to manage workflows.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
              <Input
                placeholder="Search workflows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Workflow list */}
            <div className="border border-border-subtle rounded-lg">
              <ScrollArea className="max-h-48">
                <div className="p-1.5 space-y-0.5">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                    </div>
                  ) : filteredWorkflows.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-4">
                      {searchQuery
                        ? "No workflows match your search."
                        : "No workflows yet."}
                    </p>
                  ) : (
                    filteredWorkflows.map((w) => (
                      <button
                        key={w.id}
                        className={`w-full flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                          selectedWorkflowId === w.id
                            ? "bg-brand-primary/10 ring-1 ring-brand-primary/30"
                            : "hover:bg-surface-raised/60"
                        }`}
                        onClick={() => setSelectedWorkflowId(w.id)}
                      >
                        {selectedWorkflowId === w.id ? (
                          <Check className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {w.name || "Untitled"}
                          </div>
                          {w.description && (
                            <div className="text-xs text-text-muted truncate">
                              {w.description}
                            </div>
                          )}
                        </div>
                        {w.category && w.category !== "general" && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 shrink-0"
                          >
                            {w.category}
                          </Badge>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* New workflow button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleCreateWorkflow}
              disabled={isCreating}
            >
              {isCreating ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              New Workflow
            </Button>

            {/* Phase selector */}
            {selectedWorkflowId && (
              <div>
                <p className="text-xs text-text-muted mb-1.5">Add to phase:</p>
                <div className="flex flex-wrap gap-1.5">
                  {validPhases.map((phase) => (
                    <button
                      key={phase}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        selectedPhase === phase
                          ? PHASE_COLORS[phase]
                          : "border-border-subtle text-text-muted hover:border-border-default"
                      }`}
                      onClick={() => setSelectedPhase(phase)}
                    >
                      {PHASE_INFO[phase].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleAddStep}
            disabled={
              !selectedWorkflowId || !selectedPhase || isAdding || isOffline
            }
          >
            {isAdding ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Step"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
