"use client";

import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import type { OutgoingTransitionBuilderProps } from "../types";

const DEFAULT_CATEGORY_FILTER = "Outgoing Transitions";

export function useTransitionBuilderState({
  preselectedWorkflow,
  preselectedOriginState,
  onClose,
}: OutgoingTransitionBuilderProps) {
  const { states, workflows, addTransition } = useAutomation();

  const [open, setOpen] = useState(
    !!preselectedWorkflow || !!preselectedOriginState
  );
  const [fromState, setFromState] = useState(preselectedOriginState || "");
  const [staysVisible, setStaysVisible] = useState(false);
  const [activateStates, setActivateStates] = useState<string[]>([]);
  const [deactivateStates, setDeactivateStates] = useState<string[]>([]);
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>(
    preselectedWorkflow ? [preselectedWorkflow] : []
  );
  const [workflowCategoryFilter, setWorkflowCategoryFilter] = useState<string>(
    DEFAULT_CATEGORY_FILTER
  );

  const handleFromStateChange = useCallback((stateId: string) => {
    setFromState(stateId);
    setActivateStates((prev) => prev.filter((id) => id !== stateId));
    setDeactivateStates((prev) => prev.filter((id) => id !== stateId));
  }, []);

  const handleStaysVisibleChange = useCallback(
    (checked: boolean) => {
      setStaysVisible(checked);
      if (checked && fromState) {
        setDeactivateStates((prev) => prev.filter((id) => id !== fromState));
      }
    },
    [fromState]
  );

  const moveToActivate = useCallback(
    (stateId: string) => {
      setDeactivateStates((prev) => prev.filter((id) => id !== stateId));
      if (!activateStates.includes(stateId)) {
        setActivateStates((prev) => [...prev, stateId]);
      }
    },
    [activateStates]
  );

  const moveToDeactivate = useCallback(
    (stateId: string) => {
      setActivateStates((prev) => prev.filter((id) => id !== stateId));
      if (!deactivateStates.includes(stateId)) {
        setDeactivateStates((prev) => [...prev, stateId]);
      }
    },
    [deactivateStates]
  );

  const moveToAvailable = useCallback(
    (stateId: string, from: "activate" | "deactivate") => {
      if (from === "activate") {
        setActivateStates((prev) => prev.filter((id) => id !== stateId));
      } else {
        setDeactivateStates((prev) => prev.filter((id) => id !== stateId));
      }
    },
    []
  );

  const addSelectedWorkflow = useCallback((workflowId: string) => {
    setSelectedWorkflows((prev) => [...prev, workflowId]);
  }, []);

  const removeSelectedWorkflow = useCallback((workflowId: string) => {
    setSelectedWorkflows((prev) => prev.filter((id) => id !== workflowId));
  }, []);

  const resetForm = useCallback(() => {
    setFromState("");
    setStaysVisible(false);
    setActivateStates([]);
    setDeactivateStates([]);
    setSelectedWorkflows([]);
    setWorkflowCategoryFilter(DEFAULT_CATEGORY_FILTER);
  }, []);

  const handleCreate = useCallback(async () => {
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

    const wasAdded = await addTransition(newTransition);
    if (!wasAdded) {
      toast.error(
        "A transition with the same origin and target states already exists"
      );
      return;
    }
    toast.success("Outgoing transition created");

    resetForm();
    setOpen(false);
    onClose?.();
  }, [
    fromState,
    activateStates,
    staysVisible,
    deactivateStates,
    selectedWorkflows,
    addTransition,
    resetForm,
    onClose,
  ]);

  const availableStates = useMemo(
    () =>
      states.filter(
        (state) =>
          state.id !== fromState &&
          !activateStates.includes(state.id) &&
          !deactivateStates.includes(state.id)
      ),
    [states, fromState, activateStates, deactivateStates]
  );

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen);
      if (!newOpen) {
        onClose?.();
      }
    },
    [onClose]
  );

  return {
    // Context data
    states,
    workflows,
    // Dialog state
    open,
    handleOpenChange,
    // Form state
    fromState,
    staysVisible,
    activateStates,
    deactivateStates,
    selectedWorkflows,
    workflowCategoryFilter,
    // Derived
    availableStates,
    // State handlers
    handleFromStateChange,
    handleStaysVisibleChange,
    moveToActivate,
    moveToDeactivate,
    moveToAvailable,
    // Workflow handlers
    setWorkflowCategoryFilter,
    addSelectedWorkflow,
    removeSelectedWorkflow,
    // Actions
    handleCreate,
  };
}
