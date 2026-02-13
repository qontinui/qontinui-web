"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { TabsContent } from "@/components/ui/tabs";
import type {
  State,
  IncomingTransition,
  Transition,
} from "@/stores/automation";
import type { Workflow } from "@/lib/action-schema/action-types";
import { createFindAnyStateImageWorkflow } from "@/lib/workflow-helpers";
import { createLogger } from "@/lib/logger";
const logger = createLogger("TransitionsTab");

interface TransitionsTabProps {
  state: State;
  incomingTransitions: IncomingTransition[];
  workflows: Workflow[];
  addTransition: (transition: Transition) => Promise<boolean>;
  updateTransition: (transition: Transition) => void;
  addWorkflow: (workflow: Workflow) => void;
}

export function TransitionsTab({
  state,
  incomingTransitions,
  workflows,
  addTransition,
  updateTransition,
  addWorkflow,
}: TransitionsTabProps) {
  const [expandedTransitionId, setExpandedTransitionId] = useState<
    string | null
  >(null);
  const [workflowCategoryFilters, setWorkflowCategoryFilters] = useState<{
    [key: string]: string;
  }>({});

  // Handler to create and add helper workflow for finding any state image
  const handleAddFindAnyImageHelper = async (
    transition: IncomingTransition
  ) => {
    try {
      // Generate the helper workflow
      const helperWorkflow = createFindAnyStateImageWorkflow(state);

      // Add helper workflow to global workflows database
      addWorkflow(helperWorkflow);

      // Check if this transition exists in the database
      const existingTransition = incomingTransitions.find(
        (t) => t.id === transition.id
      );

      // Add helper workflow ID to transition's workflows array
      const newWorkflows = [...(transition.workflows || []), helperWorkflow.id];

      if (existingTransition) {
        // Update existing transition
        updateTransition({ ...transition, workflows: newWorkflows });
      } else {
        // Create new transition with the helper workflow reference
        const wasAdded = await addTransition({
          ...transition,
          workflows: newWorkflows,
        });
        if (!wasAdded) {
          logger.warn("Duplicate transition detected, skipping");
        }
      }
    } catch (error) {
      logger.error("Failed to create helper workflow:", error);
    }
  };

  return (
    <TabsContent
      value="transitions"
      className="flex-1 flex flex-col min-h-0 p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs text-brand-success">
          Incoming Transition
        </Label>
        <Badge className="bg-brand-success text-black text-xs px-2">
          1
        </Badge>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto scrollbar-dark pr-2">
        {(() => {
          // Get or create the incoming transition for this state
          const transition = incomingTransitions[0] || {
            id: `incoming-${state.id}`,
            type: "IncomingTransition" as const,
            toState: state.id,
            workflows: [],
            timeout: 10000,
            retryCount: 3,
          };

          const isExpanded = expandedTransitionId === transition.id;
          const categoryFilter =
            workflowCategoryFilters[transition.id] ||
            "Incoming Transitions";
          const availableWorkflows = workflows.filter((w) => {
            const category = w.category || "Main";
            const matchesCategory =
              categoryFilter === "All" || category === categoryFilter;
            // Check if this workflow is already referenced in the transition
            const alreadyAdded = transition.workflows?.includes(w.id);
            return !alreadyAdded && matchesCategory;
          });

          return (
            <div
              key={transition.id}
              className="p-3 bg-surface-raised/50 border border-brand-success/30 rounded-lg space-y-2"
            >
              {/* Transition Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setExpandedTransitionId(
                        isExpanded ? null : transition.id
                      )
                    }
                    className="hover:text-brand-success transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-brand-success" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-text-muted" />
                    )}
                  </button>
                  <span className="text-xs text-text-muted">
                    {(transition.workflows?.length || 0) === 0
                      ? "returns true"
                      : `${transition.workflows.length} workflow${transition.workflows.length !== 1 ? "s" : ""}`}
                  </span>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="space-y-3 pt-2 border-t border-border-default">
                  {/* Workflows List */}
                  {transition.workflows &&
                    transition.workflows.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-text-muted">
                          Workflows (execute in order):
                        </Label>
                        <div className="space-y-1">
                          {transition.workflows.map((workflowId, idx) => {
                            const workflow = workflows.find(
                              (w) => w.id === workflowId
                            );
                            const workflowName =
                              workflow?.name || "Unknown Workflow";
                            const isHelper =
                              workflowId.startsWith("wf-helper-");

                            return (
                              <div
                                key={workflowId}
                                className="flex items-center gap-2 text-xs text-text-secondary p-2 bg-surface-canvas/50 rounded"
                              >
                                <Badge className="bg-brand-primary text-black text-xs px-1.5">
                                  {idx + 1}
                                </Badge>
                                <span className="flex-1">
                                  {workflowName}
                                </span>

                                {/* Helper badge for auto-generated workflows */}
                                {isHelper ? (
                                  <Badge className="bg-brand-success/20 text-brand-success border-brand-success/30 text-xs px-1.5">
                                    Helper
                                  </Badge>
                                ) : (
                                  workflow?.category && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {workflow.category}
                                    </Badge>
                                  )
                                )}

                                {/* Delete Button */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
                                  onClick={() => {
                                    const newWorkflows =
                                      transition.workflows.filter(
                                        (_, i) => i !== idx
                                      );
                                    updateTransition({
                                      ...transition,
                                      workflows: newWorkflows,
                                    });
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* Quick Helper Button */}
                  <div className="space-y-2 pb-2 border-b border-border-default">
                    <Label className="text-xs text-text-muted">
                      Quick Helper:
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs bg-brand-success/10 border-brand-success/30 text-brand-success hover:bg-brand-success/20 hover:text-brand-success hover:border-brand-success/50 transition-colors"
                      onClick={() =>
                        handleAddFindAnyImageHelper(transition)
                      }
                      disabled={
                        !state.stateImages ||
                        state.stateImages.length === 0
                      }
                    >
                      <Sparkles className="w-3 h-3 mr-2" />
                      Add &quot;Find Any State Image&quot;
                    </Button>
                    {(!state.stateImages ||
                      state.stateImages.length === 0) && (
                      <p className="text-xs text-text-muted italic">
                        Add state images first to use this helper
                      </p>
                    )}
                  </div>

                  {/* Add Workflow */}
                  <div className="space-y-2">
                    <Label className="text-xs text-text-muted">
                      Filter by Category:
                    </Label>
                    <Select
                      value={categoryFilter}
                      onValueChange={(value) => {
                        setWorkflowCategoryFilters((prev) => ({
                          ...prev,
                          [transition.id]: value,
                        }));
                      }}
                    >
                      <SelectTrigger className="bg-surface-canvas border-border-subtle text-xs h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-surface-raised border-border-default">
                        <SelectItem value="All">
                          All Categories
                        </SelectItem>
                        <SelectItem value="Incoming Transitions">
                          Incoming Transitions
                        </SelectItem>
                        <SelectItem value="Outgoing Transitions">
                          Outgoing Transitions
                        </SelectItem>
                        <SelectItem value="Main">Main</SelectItem>
                        {Array.from(
                          new Set(
                            workflows.map((w) => w.category || "Main")
                          )
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

                  {availableWorkflows.length > 0 ? (
                    <div className="space-y-2">
                      <Label className="text-xs text-text-muted">
                        Add Workflow:
                      </Label>
                      <Select
                        value=""
                        onValueChange={(workflowId) => {
                          const newWorkflows = [
                            ...(transition.workflows || []),
                            workflowId,
                          ];
                          updateTransition({
                            ...transition,
                            workflows: newWorkflows,
                          });
                        }}
                      >
                        <SelectTrigger className="bg-surface-canvas border-border-subtle text-xs h-8">
                          <SelectValue placeholder="Select workflow to add..." />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-raised border-border-default">
                          {availableWorkflows.map((workflow) => (
                            <SelectItem
                              key={workflow.id}
                              value={workflow.id}
                              className="text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span>{workflow.name}</span>
                                {workflow.category && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {workflow.category}
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="text-xs text-text-muted text-center py-2">
                      {categoryFilter === "Incoming Transitions"
                        ? "No workflows in Incoming Transitions category. Use the Quick Helper or try 'All Categories'."
                        : "No available workflows in this category"}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </TabsContent>
  );
}
