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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Trash2,
  MoveRight,
  Target,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";

export function TransitionBuilder() {
  const { states, workflows, addTransition } = useAutomation();
  const [open, setOpen] = useState(false);
  const [transitionType, setTransitionType] = useState<
    "OutgoingTransition" | "IncomingTransition"
  >("OutgoingTransition");

  // OutgoingTransition fields
  const [fromState, setFromState] = useState("");
  const [staysVisible, setStaysVisible] = useState(false);
  const [activateStates, setActivateStates] = useState<string[]>([]);
  const [deactivateStates, setDeactivateStates] = useState<string[]>([]);

  // Handle from state selection
  const handleFromStateChange = (stateId: string) => {
    setFromState(stateId);
    // Add the from state to deactivate states if not stays visible
    if (stateId && !staysVisible && !deactivateStates.includes(stateId)) {
      setDeactivateStates([...deactivateStates, stateId]);
    }
  };

  // Handle stays visible checkbox
  const handleStaysVisibleChange = (checked: boolean) => {
    setStaysVisible(checked);
    if (fromState) {
      if (checked) {
        // Remove from deactivate states if it&apos;s there
        setDeactivateStates(deactivateStates.filter((s) => s !== fromState));
      } else {
        // Add to deactivate states if not already there
        if (!deactivateStates.includes(fromState)) {
          setDeactivateStates([...deactivateStates, fromState]);
        }
      }
    }
  };

  // IncomingTransition fields
  const [incomingTransitionState, setIncomingTransitionState] = useState("");

  // Common fields
  const [selectedProcess, setSelectedProcess] = useState<string>("");

  const handleCreate = async () => {
    if (transitionType === "OutgoingTransition") {
      if (!fromState) {
        toast.error("Please select the origin state");
        return;
      }
      if (activateStates.length === 0 && deactivateStates.length === 0) {
        toast.error(
          "Please select at least one state to activate or deactivate"
        );
        return;
      }

      const transition = {
        id: `transition-${Date.now()}`,
        type: "OutgoingTransition" as const,
        fromState,
        toState: activateStates[0] || "", // Use first activated state as primary target
        staysVisible,
        activateStates,
        deactivateStates,
        workflows: selectedProcess ? [selectedProcess] : [],
        timeout: 30000,
        retryCount: 3,
      };

      const wasAdded = await addTransition(
        transition as import("@/contexts/automation-context/types").Transition
      );
      if (!wasAdded) {
        toast.error(
          "A transition with the same origin and target states already exists"
        );
        return;
      }
      toast.success("OutgoingTransition created");
    } else {
      if (!incomingTransitionState) {
        toast.error("Please select a state for the IncomingTransition");
        return;
      }

      const transition = {
        id: `transition-${Date.now()}`,
        type: "IncomingTransition" as const,
        toState: incomingTransitionState,
        workflows: selectedProcess ? [selectedProcess] : [],
        timeout: 30000,
        retryCount: 3,
      };

      const wasAdded = await addTransition(
        transition as import("@/contexts/automation-context/types").Transition
      );
      if (!wasAdded) {
        toast.error("An incoming transition for this state already exists");
        return;
      }
      toast.success("IncomingTransition created");
    }

    setOpen(false);
  };

  const addToActivateStates = (stateId: string) => {
    if (
      !activateStates.includes(stateId) &&
      !deactivateStates.includes(stateId)
    ) {
      setActivateStates([...activateStates, stateId]);
    }
  };

  const addToDeactivateStates = (stateId: string) => {
    if (
      !deactivateStates.includes(stateId) &&
      !activateStates.includes(stateId)
    ) {
      setDeactivateStates([...deactivateStates, stateId]);
    }
  };

  const removeFromActivateStates = (stateId: string) => {
    setActivateStates(activateStates.filter((s) => s !== stateId));
  };

  const removeFromDeactivateStates = (stateId: string) => {
    setDeactivateStates(deactivateStates.filter((s) => s !== stateId));
  };

  // Get available states (excluding fromState and already selected states)
  const getAvailableStates = () => {
    return states.filter(
      (s) =>
        s.id !== fromState &&
        !activateStates.includes(s.id) &&
        !deactivateStates.includes(s.id)
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full bg-brand-secondary hover:bg-brand-secondary/80 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Create Transition
        </Button>
      </DialogTrigger>

      <DialogContent
        className="bg-surface-raised border-border-default"
        style={{
          maxWidth:
            transitionType === "OutgoingTransition" ? "1400px" : "672px",
          width: transitionType === "OutgoingTransition" ? "95vw" : "auto",
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-brand-primary">
            Create Transition
          </DialogTitle>
          <DialogDescription className="text-text-muted text-sm">
            Define how states transition in your automation workflow
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={transitionType}
          onValueChange={(v) =>
            setTransitionType(v as "IncomingTransition" | "OutgoingTransition")
          }
        >
          <TabsList className="grid w-[400px] mx-auto grid-cols-2 bg-surface-overlay">
            <TabsTrigger
              value="OutgoingTransition"
              className="data-[state=active]:bg-brand-secondary"
            >
              <MoveRight className="w-4 h-4 mr-2" />
              Outgoing
            </TabsTrigger>
            <TabsTrigger
              value="IncomingTransition"
              className="data-[state=active]:bg-brand-success"
            >
              <Target className="w-4 h-4 mr-2" />
              Incoming
            </TabsTrigger>
          </TabsList>

          <TabsContent value="OutgoingTransition" className="space-y-4 mt-4">
            <div>
              <Label className="mb-2 block">From State (Origin)</Label>
              <Select value={fromState} onValueChange={handleFromStateChange}>
                <SelectTrigger className="bg-transparent border-border-subtle">
                  <SelectValue placeholder="Select origin state" />
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
                <Card className="bg-surface-overlay border-red-400/50">
                  <CardContent className="p-3 h-[400px] overflow-y-auto">
                    {deactivateStates.length === 0 ? (
                      <p className="text-sm text-text-muted text-center pt-8">
                        No states selected
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {deactivateStates.map((stateId) => {
                          const state = states.find((s) => s.id === stateId);
                          const isOriginState = stateId === fromState;
                          return state ? (
                            <div
                              key={state.id}
                              className={`flex items-center justify-between p-2 rounded border ${
                                isOriginState
                                  ? "bg-red-500/30 border-red-500/70"
                                  : "bg-red-400/20 border-red-400/50"
                              }`}
                            >
                              <span className="text-sm">
                                {state.name}
                                {isOriginState && (
                                  <span className="text-xs text-red-300 ml-2">
                                    (Origin)
                                  </span>
                                )}
                              </span>
                              {!isOriginState && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 hover:bg-surface-sunken"
                                  onClick={() =>
                                    removeFromDeactivateStates(state.id)
                                  }
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
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
                <Label className="text-sm font-semibold mb-2 text-text-muted">
                  Available States
                </Label>
                <Card className="bg-surface-overlay border-border-default">
                  <CardContent className="p-3 h-[400px] overflow-y-auto">
                    {getAvailableStates().length === 0 ? (
                      <p className="text-sm text-text-muted text-center pt-8">
                        No available states
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {getAvailableStates().map((state) => (
                          <div
                            key={state.id}
                            className="flex items-center gap-2"
                          >
                            {/* Left red triangle for deactivate */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-red-500 hover:text-red-400 hover:bg-red-400/20"
                              onClick={() => addToDeactivateStates(state.id)}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>

                            <div className="flex-1 p-2 rounded bg-surface-sunken hover:bg-surface-overlay text-center">
                              <span className="text-sm">{state.name}</span>
                            </div>

                            {/* Right green triangle for activate */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-brand-success hover:text-brand-success/80 hover:bg-brand-success/20"
                              onClick={() => addToActivateStates(state.id)}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* States to Activate Column - RIGHT */}
              <div>
                <Label className="text-sm font-semibold mb-2 text-brand-success">
                  States to Activate
                </Label>
                <Card className="bg-surface-overlay border-brand-success/50">
                  <CardContent className="p-3 h-[400px] overflow-y-auto">
                    {activateStates.length === 0 ? (
                      <p className="text-sm text-text-muted text-center pt-8">
                        No states selected
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {activateStates.map((stateId) => {
                          const state = states.find((s) => s.id === stateId);
                          return state ? (
                            <div
                              key={state.id}
                              className="flex items-center justify-between p-2 rounded bg-brand-success/20 border border-brand-success/50"
                            >
                              <span className="text-sm">{state.name}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 hover:bg-red-400/20"
                                onClick={() =>
                                  removeFromActivateStates(state.id)
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : null;
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="IncomingTransition" className="space-y-4 mt-4">
            <div className="max-w-md">
              <div>
                <Label>State (executes when entering)</Label>
                <Select
                  value={incomingTransitionState}
                  onValueChange={setIncomingTransitionState}
                >
                  <SelectTrigger className="bg-transparent border-border-subtle mt-2">
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

              <div className="p-4 bg-surface-overlay rounded-lg mt-4">
                <p className="text-sm text-text-muted">
                  IncomingTransitions are executed automatically after any
                  successful OutgoingTransition that navigates to this state.
                  They&apos;re useful for setup actions that should always
                  happen when entering a state.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-4 border-t border-border-default">
          <div>
            <Label>Process to Execute</Label>
            <Select value={selectedProcess} onValueChange={setSelectedProcess}>
              <SelectTrigger className="bg-transparent border-border-subtle mt-2">
                <SelectValue placeholder="Select a process to execute" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {workflows.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No workflows available
                  </SelectItem>
                ) : (
                  workflows.map((process) => (
                    <SelectItem key={process.id} value={process.id}>
                      <div className="flex items-center gap-2">
                        <span>{process.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {process.actions.length} actions
                        </Badge>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedProcess &&
              workflows.find((p) => p.id === selectedProcess)?.description && (
                <p className="text-xs text-text-muted mt-2">
                  {workflows.find((p) => p.id === selectedProcess)?.description}
                </p>
              )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            className="px-8 border-border-subtle"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="px-8 bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            Create{" "}
            {transitionType === "OutgoingTransition" ? "Outgoing" : "Incoming"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
