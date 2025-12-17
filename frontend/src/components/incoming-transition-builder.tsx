"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";

interface IncomingTransitionBuilderProps {
  preselectedWorkflow?: string;
  onClose?: () => void;
}

export function IncomingTransitionBuilder({
  preselectedWorkflow,
  onClose,
}: IncomingTransitionBuilderProps = {}) {
  const { states, workflows, addTransition } = useAutomation();
  const [open, setOpen] = useState(!!preselectedWorkflow);

  // IncomingTransition fields
  const [toState, setToState] = useState("");
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>(
    preselectedWorkflow ? [preselectedWorkflow] : []
  );
  const [workflowCategoryFilter, setWorkflowCategoryFilter] = useState<string>(
    "Incoming Transitions"
  );

  const handleCreate = () => {
    if (!toState) {
      toast.error("Please select a state");
      return;
    }

    if (selectedWorkflows.length === 0) {
      toast.error("Please select at least one workflow to execute");
      return;
    }

    const newTransition = {
      id: `transition-${Date.now()}`,
      type: "IncomingTransition" as const,
      toState,
      workflows: selectedWorkflows,
      timeout: 10000,
      retryCount: 0,
    };

    addTransition(newTransition);
    toast.success("Incoming transition created");

    // Reset form
    setToState("");
    setSelectedWorkflows([]);
    setWorkflowCategoryFilter("Incoming Transitions");
    setOpen(false);
    onClose?.();
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      onClose?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!preselectedWorkflow && (
        <DialogTrigger asChild>
          <Button className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black">
            <ArrowDownToLine className="w-4 h-4 mr-2" />
            Create Incoming Transition
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="bg-[#27272A] border-gray-700 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#00D9FF]">
            Create Incoming Transition
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            Define a process that executes when entering a state
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>State (executes when entering)</Label>
            <Select value={toState} onValueChange={setToState}>
              <SelectTrigger className="bg-transparent border-gray-600 mt-2">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {states.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="p-4 bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-400">
              IncomingTransitions are executed automatically after any
              successful OutgoingTransition that navigates to this state.
              They're useful for setup actions that should always happen when
              entering a state.
            </p>
          </div>

          <div className="pt-4 border-t border-gray-700 space-y-3">
            <Label>Workflows to Execute</Label>

            {/* Category Filter */}
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">
                Filter by Category
              </Label>
              <Select
                value={workflowCategoryFilter}
                onValueChange={setWorkflowCategoryFilter}
              >
                <SelectTrigger className="bg-transparent border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#27272A] border-gray-700">
                  <SelectItem value="All">All Categories</SelectItem>
                  <SelectItem value="Incoming Transitions">
                    Incoming Transitions
                  </SelectItem>
                  <SelectItem value="Outgoing Transitions">
                    Outgoing Transitions
                  </SelectItem>
                  <SelectItem value="Main">Main</SelectItem>
                  {Array.from(
                    new Set(workflows.map((w) => w.category || "Main"))
                  )
                    .filter(
                      (c) =>
                        c !== "Main" &&
                        c !== "Transitions" &&
                        c !== "Incoming Transitions" &&
                        c !== "Outgoing Transitions"
                    )
                    .map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Workflow Selection */}
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">
                Available Workflows
              </Label>
              <div className="max-h-[200px] overflow-y-auto space-y-1 border border-gray-700 rounded p-2">
                {workflows
                  .filter((w) => {
                    const category = w.category || "Main";
                    return (
                      workflowCategoryFilter === "All" ||
                      category === workflowCategoryFilter
                    );
                  })
                  .filter((w) => !selectedWorkflows.includes(w.id)).length ===
                0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {workflowCategoryFilter === "Incoming Transitions"
                      ? "No workflows in Incoming Transitions category. Create one using the workflow editor or try 'All Categories'."
                      : "No available workflows"}
                  </p>
                ) : (
                  workflows
                    .filter((w) => {
                      const category = w.category || "Main";
                      return (
                        workflowCategoryFilter === "All" ||
                        category === workflowCategoryFilter
                      );
                    })
                    .filter((w) => !selectedWorkflows.includes(w.id))
                    .map((workflow) => (
                      <button
                        key={workflow.id}
                        type="button"
                        onClick={() =>
                          setSelectedWorkflows((prev) => [...prev, workflow.id])
                        }
                        className="w-full text-left p-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span>{workflow.name}</span>
                          <Badge className="text-xs">
                            {workflow.category || "Main"}
                          </Badge>
                        </div>
                        {workflow.description && (
                          <p className="text-xs text-gray-400 mt-1">
                            {workflow.description}
                          </p>
                        )}
                      </button>
                    ))
                )}
              </div>
            </div>

            {/* Selected Workflows */}
            {selectedWorkflows.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-gray-400">
                  Selected Workflows (will execute in order)
                </Label>
                <div className="space-y-1">
                  {selectedWorkflows.map((workflowId, index) => {
                    const workflow = workflows.find((w) => w.id === workflowId);
                    return (
                      <div
                        key={workflowId}
                        className="flex items-center justify-between p-2 bg-gray-800 rounded"
                      >
                        <div className="flex items-center gap-2 flex-1">
                          <Badge className="text-xs bg-[#00D9FF] text-black">
                            {index + 1}
                          </Badge>
                          <span className="text-sm">
                            {workflow?.name || "Unknown"}
                          </span>
                          {workflow?.category && (
                            <Badge variant="outline" className="text-xs">
                              {workflow.category}
                            </Badge>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                          onClick={() =>
                            setSelectedWorkflows((prev) =>
                              prev.filter((id) => id !== workflowId)
                            )
                          }
                        >
                          <span className="text-lg">×</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="px-8 border-gray-600"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              className="px-8 bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
            >
              Create Incoming Transition
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
