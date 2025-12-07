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
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRightLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";

interface OutgoingTransitionBuilderProps {
  preselectedWorkflow?: string;
  onClose?: () => void;
}

export function OutgoingTransitionBuilder({
  preselectedWorkflow,
  onClose,
}: OutgoingTransitionBuilderProps = {}) {
  const { states, workflows, addTransition } = useAutomation();
  const [open, setOpen] = useState(!!preselectedWorkflow);

  // OutgoingTransition fields
  const [fromState, setFromState] = useState("");
  const [staysVisible, setStaysVisible] = useState(false);
  const [activateStates, setActivateStates] = useState<string[]>([]);
  const [deactivateStates, setDeactivateStates] = useState<string[]>([]);
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>(
    preselectedWorkflow ? [preselectedWorkflow] : []
  );
  const [workflowCategoryFilter, setWorkflowCategoryFilter] =
    useState<string>("Transitions");

  // Handle from state selection
  const handleFromStateChange = (stateId: string) => {
    setFromState(stateId);
    // Remove the selected state from both activate and deactivate lists
    setActivateStates((prev) => prev.filter((id) => id !== stateId));
    setDeactivateStates((prev) => prev.filter((id) => id !== stateId));
  };

  const handleStaysVisibleChange = (checked: boolean) => {
    setStaysVisible(checked);
    if (checked && fromState) {
      // Remove from deactivate states if stays visible is checked
      setDeactivateStates((prev) => prev.filter((id) => id !== fromState));
    }
  };

  // Move state between lists
  const moveToActivate = (stateId: string) => {
    setDeactivateStates((prev) => prev.filter((id) => id !== stateId));
    if (!activateStates.includes(stateId)) {
      setActivateStates((prev) => [...prev, stateId]);
    }
  };

  const moveToDeactivate = (stateId: string) => {
    setActivateStates((prev) => prev.filter((id) => id !== stateId));
    if (!deactivateStates.includes(stateId)) {
      setDeactivateStates((prev) => [...prev, stateId]);
    }
  };

  const moveToAvailable = (
    stateId: string,
    from: "activate" | "deactivate"
  ) => {
    if (from === "activate") {
      setActivateStates((prev) => prev.filter((id) => id !== stateId));
    } else {
      setDeactivateStates((prev) => prev.filter((id) => id !== stateId));
    }
  };

  const handleCreate = () => {
    if (!fromState) {
      toast.error("Please select an origin state");
      return;
    }

    if (activateStates.length === 0) {
      toast.error("Please select at least one state to activate");
      return;
    }

    const newTransition = {
      id: `transition-${Date.now()}`,
      type: "OutgoingTransition" as const,
      fromState,
      activateStates,
      staysVisible,
      deactivateStates,
      workflows: selectedWorkflows,
      timeout: 10000,
      retryCount: 0,
    };

    addTransition(newTransition);
    toast.success("Outgoing transition created");

    // Reset form
    setFromState("");
    setStaysVisible(false);
    setActivateStates([]);
    setDeactivateStates([]);
    setSelectedWorkflows([]);
    setWorkflowCategoryFilter("Transitions");
    setOpen(false);
    onClose?.();
  };

  // Get available states (not in activate or deactivate lists, and not the from state)
  const availableStates = states.filter(
    (state) =>
      state.id !== fromState &&
      !activateStates.includes(state.id) &&
      !deactivateStates.includes(state.id)
  );

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
          <Button className="w-full bg-[#00FF88] hover:bg-[#00FF88]/80 text-black">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Create Outgoing Transition
          </Button>
        </DialogTrigger>
      )}

      <DialogContent
        className="bg-[#27272A] border-gray-700"
        style={{ maxWidth: "1400px", width: "95vw" }}
      >
        <DialogHeader>
          <DialogTitle className="text-[#00FF88]">
            Create Outgoing Transition
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            Define a transition from one state to multiple target states
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">From State (Origin)</Label>
            <Select value={fromState} onValueChange={handleFromStateChange}>
              <SelectTrigger className="bg-transparent border-gray-600">
                <SelectValue placeholder="Select origin state" />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                {states.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="stays-visible"
              checked={staysVisible}
              onCheckedChange={handleStaysVisibleChange}
            />
            <Label htmlFor="stays-visible" className="text-sm">
              Origin state stays visible after transition
            </Label>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* States to Deactivate Column - LEFT */}
            <div>
              <Label className="text-sm font-semibold mb-2 text-red-400">
                States to Deactivate
              </Label>
              <Card className="bg-gray-800 border-red-400/50">
                <CardContent className="p-3 h-[400px] overflow-y-auto">
                  {deactivateStates.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center pt-8">
                      No states selected
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {deactivateStates.map((stateId) => {
                        const state = states.find((s) => s.id === stateId);
                        return state ? (
                          <div
                            key={stateId}
                            className="p-2 bg-gray-900 rounded flex items-center justify-between hover:bg-gray-700 cursor-pointer transition-colors"
                            onClick={() =>
                              moveToAvailable(stateId, "deactivate")
                            }
                          >
                            <span className="text-sm">{state.name}</span>
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Available States Column - MIDDLE */}
            <div>
              <Label className="text-sm font-semibold mb-2">
                Available States
              </Label>
              <Card className="bg-gray-800">
                <CardContent className="p-3 h-[400px] overflow-y-auto">
                  {!fromState ? (
                    <p className="text-sm text-gray-500 text-center pt-8">
                      Select origin state first
                    </p>
                  ) : availableStates.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center pt-8">
                      No states available
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {availableStates.map((state) => (
                        <div
                          key={state.id}
                          className="p-2 bg-gray-900 rounded hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-1 h-auto hover:bg-red-400/20"
                              onClick={() => moveToDeactivate(state.id)}
                            >
                              <ChevronLeft className="w-4 h-4 text-red-400" />
                            </Button>

                            <span className="text-sm mx-2 flex-1 text-center">
                              {state.name}
                            </span>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-1 h-auto hover:bg-green-400/20"
                              onClick={() => moveToActivate(state.id)}
                            >
                              <ChevronRight className="w-4 h-4 text-green-400" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* States to Activate Column - RIGHT */}
            <div>
              <Label className="text-sm font-semibold mb-2 text-green-400">
                States to Activate
              </Label>
              <Card className="bg-gray-800 border-green-400/50">
                <CardContent className="p-3 h-[400px] overflow-y-auto">
                  {activateStates.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center pt-8">
                      No states selected
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activateStates.map((stateId) => {
                        const state = states.find((s) => s.id === stateId);
                        return state ? (
                          <div
                            key={stateId}
                            className="p-2 bg-gray-900 rounded flex items-center justify-between hover:bg-gray-700 cursor-pointer transition-colors"
                            onClick={() => moveToAvailable(stateId, "activate")}
                          >
                            <ChevronLeft className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">{state.name}</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-700">
            <Label>Workflows to Execute (Optional)</Label>

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
                <SelectContent className="z-[100] bg-[#27272A] border-gray-700">
                  <SelectItem value="All">All Categories</SelectItem>
                  <SelectItem value="Transitions">Transitions</SelectItem>
                  <SelectItem value="Main">Main</SelectItem>
                  {Array.from(
                    new Set(workflows.map((w) => w.category || "Main"))
                  )
                    .filter((c) => c !== "Main" && c !== "Transitions")
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
              <div className="max-h-[180px] overflow-y-auto space-y-1 border border-gray-700 rounded p-2">
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
                    {workflowCategoryFilter === "Transitions"
                      ? "No workflows in Transitions category. Try 'All Categories' to see all workflows."
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
                          <Badge className="text-xs bg-[#00FF88] text-black">
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
              className="px-8 bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
            >
              Create Outgoing Transition
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
