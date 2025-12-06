"use client";

import React, { useState } from "react";
import {
  Transition,
  State,
  OutgoingTransition,
} from "@/contexts/automation-context/types";
import { Workflow } from "@/lib/action-schema/action-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Layers, ArrowRight, X } from "lucide-react";

interface BulkCreationWizardProps {
  states: State[];
  workflows: Workflow[];
  onComplete: (transitions: Transition[]) => void;
}

export function BulkCreationWizard({
  states,
  workflows,
  onComplete,
}: BulkCreationWizardProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [sourceStates, setSourceStates] = useState<string[]>([]);
  const [targetStates, setTargetStates] = useState<string[]>([]);
  const [config, setConfig] = useState({
    timeout: 10000,
    retryCount: 0,
    workflows: [] as string[],
  });

  const handleComplete = () => {
    const newTransitions: Transition[] = [];

    sourceStates.forEach((fromStateId) => {
      targetStates.forEach((toStateId) => {
        const transition: OutgoingTransition = {
          id: `transition-${Date.now()}-${Math.random()}`,
          type: "OutgoingTransition",
          fromState: fromStateId,
          activateStates: [toStateId],
          staysVisible: false,
          deactivateStates: [],
          workflows: config.workflows,
          timeout: config.timeout,
          retryCount: config.retryCount,
        };
        newTransitions.push(transition);
      });
    });

    onComplete(newTransitions);
    setOpen(false);
    setStep(1);
    setSourceStates([]);
    setTargetStates([]);
    setConfig({ timeout: 10000, retryCount: 0, workflows: [] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white">
          <Layers className="w-4 h-4 mr-2" />
          Bulk Create
        </Button>
      </DialogTrigger>

      <DialogContent className="bg-[#27272A] border-gray-700 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#BD00FF]">
            Bulk Transition Creation
          </DialogTitle>
          <DialogDescription>
            Step {step} of 4 - Create multiple transitions at once
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 1 && (
            <div className="space-y-3">
              <Label>Select Source States</Label>
              <ScrollArea className="h-[300px] border border-gray-700 rounded p-3">
                <div className="space-y-2">
                  {states.map((state) => (
                    <div key={state.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={sourceStates.includes(state.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSourceStates([...sourceStates, state.id]);
                          } else {
                            setSourceStates(
                              sourceStates.filter((id) => id !== state.id)
                            );
                          }
                        }}
                      />
                      <Label className="cursor-pointer">{state.name}</Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-xs text-gray-400">
                Selected: {sourceStates.length} state(s)
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Label>Select Target States</Label>
              <ScrollArea className="h-[300px] border border-gray-700 rounded p-3">
                <div className="space-y-2">
                  {states.map((state) => (
                    <div key={state.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={targetStates.includes(state.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setTargetStates([...targetStates, state.id]);
                          } else {
                            setTargetStates(
                              targetStates.filter((id) => id !== state.id)
                            );
                          }
                        }}
                      />
                      <Label className="cursor-pointer">{state.name}</Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-xs text-gray-400">
                Selected: {targetStates.length} state(s)
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <Label>Configure Transitions</Label>

              <div className="space-y-3 border border-gray-700 rounded p-4">
                <div className="space-y-2">
                  <Label className="text-xs">Timeout (ms)</Label>
                  <Input
                    type="number"
                    value={config.timeout}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        timeout: parseInt(e.target.value) || 0,
                      })
                    }
                    className="bg-transparent border-gray-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Retry Count</Label>
                  <Input
                    type="number"
                    value={config.retryCount}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        retryCount: parseInt(e.target.value) || 0,
                      })
                    }
                    className="bg-transparent border-gray-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Workflows (optional)</Label>
                  <Select
                    value=""
                    onValueChange={(value) =>
                      setConfig({
                        ...config,
                        workflows: [...config.workflows, value],
                      })
                    }
                  >
                    <SelectTrigger className="bg-transparent border-gray-700">
                      <SelectValue placeholder="Add workflow..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows
                        .filter((w) => !config.workflows.includes(w.id))
                        .map((workflow) => (
                          <SelectItem key={workflow.id} value={workflow.id}>
                            {workflow.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {config.workflows.length > 0 && (
                    <div className="space-y-1">
                      {config.workflows.map((wId) => {
                        const workflow = workflows.find((w) => w.id === wId);
                        return (
                          <div
                            key={wId}
                            className="flex items-center justify-between p-2 bg-gray-800 rounded"
                          >
                            <span className="text-sm">
                              {workflow?.name || "Unknown"}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-400"
                              onClick={() =>
                                setConfig({
                                  ...config,
                                  workflows: config.workflows.filter(
                                    (id) => id !== wId
                                  ),
                                })
                              }
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <Label>Preview</Label>
              <div className="border border-gray-700 rounded p-4 space-y-2">
                <p className="text-sm text-gray-400">
                  Will create{" "}
                  <span className="text-[#00D9FF] font-medium">
                    {sourceStates.length * targetStates.length}
                  </span>{" "}
                  transition(s)
                </p>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-1 text-xs">
                    {sourceStates.map((fromId) =>
                      targetStates.map((toId) => (
                        <div
                          key={`${fromId}-${toId}`}
                          className="flex items-center gap-2 p-2 bg-gray-800 rounded"
                        >
                          <span>
                            {states.find((s) => s.id === fromId)?.name}
                          </span>
                          <ArrowRight className="w-3 h-3" />
                          <span>{states.find((s) => s.id === toId)?.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <Button
              variant="outline"
              onClick={() => setStep(Math.max(1, step - 1))}
              disabled={step === 1}
              className="border-gray-700"
            >
              Previous
            </Button>
            <span className="text-xs text-gray-400">Step {step} of 4</span>
            {step < 4 ? (
              <Button
                onClick={() => setStep(Math.min(4, step + 1))}
                disabled={
                  (step === 1 && sourceStates.length === 0) ||
                  (step === 2 && targetStates.length === 0)
                }
                className="bg-[#BD00FF] hover:bg-[#BD00FF]/80"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                className="bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
              >
                Create Transitions
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
