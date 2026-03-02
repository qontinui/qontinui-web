import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { hasNonLinearConnections } from "../types";
import type { Workflow, Action } from "@/lib/action-schema/action-types";

export function useProcessBuilder() {
  const [selectedItem, setSelectedItem] = useState<Workflow | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [transitionType, setTransitionType] = useState<
    "incoming" | "outgoing" | null
  >(null);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [conversionItem, setConversionItem] = useState<Workflow | null>(null);
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);

  const {
    workflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    categories,
    screenshots,
    states,
  } = useAutomation();

  // Get selected process from selected item
  const selectedProcess = selectedItem;

  // Get all unique categories from workflows and context
  const categoryNames = categories.map((c) => c.name);
  const allCategories = [
    ...new Set([
      "Main",
      "Incoming Transitions",
      "Outgoing Transitions",
      ...categoryNames,
      ...workflows.map((w) => w.category || "Main"),
    ]),
  ];

  // Keep selectedProcess in sync with the workflows from context
  useEffect(() => {
    if (selectedProcess) {
      const updatedProcess = workflows.find((w) => w.id === selectedProcess.id);
      if (updatedProcess && updatedProcess !== selectedProcess) {
        setSelectedItem(updatedProcess);
        // Also update selectedAction if it exists
        if (selectedAction) {
          const updatedAction = updatedProcess.actions.find(
            (a) => a.id === selectedAction.id
          );
          if (updatedAction) {
            setSelectedAction(updatedAction);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedProcess and selectedAction are derived from workflows, adding them causes infinite loops
  }, [workflows, selectedProcess?.id, selectedAction?.id]);

  const createNewProcess = (category: string = "Main") => {
    const newProcess: Workflow = {
      id: `workflow-${Date.now()}`,
      name: "New Workflow",
      version: "1.0.0",
      format: "graph" as const,
      description: "",
      category,
      actions: [],
      connections: {},
    };
    addWorkflow(newProcess);
    setSelectedItem(newProcess);
  };

  const handleUpdateProcess = (updatedProcess: Workflow) => {
    updateWorkflow(updatedProcess);
    // Don't set selectedItem here - let useEffect handle it
  };

  const handleSelectItem = (item: Workflow) => {
    // Check if this is a graph workflow (has non-linear connections)
    const isGraphWorkflow =
      item.metadata?.viewMode === "graph" || hasNonLinearConnections(item);
    if (isGraphWorkflow) {
      // Graph workflows can't be edited in the sequential builder
      toast.info("Graph workflows can only be edited in the Graph Builder", {
        description: "Switch to the Graph Builder tab to edit this workflow.",
      });
      return;
    }
    setSelectedItem(item);
    setSelectedAction(null);
  };

  const handleDeleteItem = (item: Workflow) => {
    deleteWorkflow(item.id);
    if (selectedItem && selectedItem.id === item.id) {
      setSelectedItem(null);
      setSelectedAction(null);
    }
  };

  const handleConvertItem = (item: Workflow) => {
    setConversionItem(item);
    setConversionDialogOpen(true);
  };

  const handleConversionComplete = (converted: Workflow) => {
    addWorkflow(converted);
    toast.success("Workflow converted", {
      description: `"${converted.name}" has been converted.`,
    });
  };

  const openTransitionDialog = (type: "incoming" | "outgoing") => {
    setTransitionType(type);
    setShowTransitionDialog(true);
  };

  const closeTransitionDialog = () => {
    setShowTransitionDialog(false);
    setTransitionType(null);
  };

  return {
    // State
    selectedItem,
    selectedProcess,
    selectedAction,
    showTransitionDialog,
    transitionType,
    optionsExpanded,
    conversionItem,
    conversionDialogOpen,

    // Derived data
    allCategories,
    screenshots,
    states,

    // Setters
    setSelectedAction,
    setOptionsExpanded,
    setConversionDialogOpen,

    // Handlers
    createNewProcess,
    handleUpdateProcess,
    handleSelectItem,
    handleDeleteItem,
    handleConvertItem,
    handleConversionComplete,
    openTransitionDialog,
    closeTransitionDialog,
  };
}
