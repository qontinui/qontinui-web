"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";
import type {
  OutgoingTransition,
  TransitionPropertiesPanelProps,
} from "./types";
import { useStateManagement } from "./_hooks/use-state-management";
import { useWorkflowManagement } from "./_hooks/use-workflow-management";
import { StateListSection } from "./_components/state-list-section";
import { WorkflowPickerDialog } from "./_components/workflow-picker-dialog";
import { WorkflowList } from "./_components/workflow-list";

export function TransitionPropertiesPanel({
  transition,
  states,
  processes,
  updateTransition,
  deleteTransition,
}: TransitionPropertiesPanelProps) {
  const {
    stateDialogOpen,
    setStateDialogOpen,
    selectedStateType,
    setSelectedStateType,
    handleAddState,
    handleRemoveState,
    availableStates,
  } = useStateManagement(transition, states, updateTransition);

  const {
    workflowDialogOpen,
    setWorkflowDialogOpen,
    workflowCategoryFilter,
    setWorkflowCategoryFilter,
    handleAddWorkflow,
    handleRemoveWorkflow,
    handleMoveWorkflowUp,
    handleMoveWorkflowDown,
    workflowCategories,
    availableWorkflows,
  } = useWorkflowManagement(transition, processes, updateTransition);

  return (
    <Card className="border-border-default bg-surface-raised h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-brand-secondary">
            Transition Properties
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-400/20"
            onClick={() => deleteTransition(transition.id)}
            title="Delete Transition"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Type</Label>
          <div className="p-2 bg-surface-overlay rounded text-sm">
            {transition.type === "OutgoingTransition" ? (
              <span className="text-brand-secondary">OutgoingTransition</span>
            ) : (
              <span className="text-brand-success">IncomingTransition</span>
            )}
          </div>
        </div>

        {transition.type === "OutgoingTransition" ? (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-text-muted">From State</Label>
              <div className="p-2 bg-surface-overlay rounded text-sm">
                {states.find((s) => s.id === transition.fromState)?.name ||
                  "Unknown State"}
              </div>
            </div>

            <StateListSection
              label="States to Activate"
              dialogTitle="Add State to Activate"
              dialogDescription="Select a state to activate when this transition occurs"
              stateType="activate"
              stateIds={transition.activateStates}
              states={states}
              availableStates={availableStates}
              dialogOpen={stateDialogOpen}
              selectedStateType={selectedStateType}
              onDialogOpenChange={setStateDialogOpen}
              onSelectStateType={setSelectedStateType}
              onAddState={handleAddState}
              onRemoveState={handleRemoveState}
              emptyMessage="No states to activate"
            />

            <div className="flex items-center space-x-2">
              <Checkbox
                id="stays_visible"
                checked={transition.staysVisible}
                onCheckedChange={(checked) =>
                  updateTransition({
                    staysVisible: !!checked,
                  } as Partial<OutgoingTransition>)
                }
              />
              <Label
                htmlFor="stays_visible"
                className="text-xs text-text-muted"
              >
                Origin state stays visible
              </Label>
            </div>

            <StateListSection
              label="States to Deactivate"
              dialogTitle="Add State to Deactivate"
              dialogDescription="Select a state to deactivate when this transition occurs"
              stateType="deactivate"
              stateIds={transition.deactivateStates}
              states={states}
              availableStates={availableStates}
              dialogOpen={stateDialogOpen}
              selectedStateType={selectedStateType}
              onDialogOpenChange={setStateDialogOpen}
              onSelectStateType={setSelectedStateType}
              onAddState={handleAddState}
              onRemoveState={handleRemoveState}
              emptyMessage="No states to deactivate"
            />
          </>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">
              State (executes when entering)
            </Label>
            <div className="p-2 bg-surface-overlay rounded text-sm">
              {states.find((s) => s.id === transition.toState)?.name ||
                "Unknown State"}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-text-muted">
              Workflows to Execute
            </Label>
            <WorkflowPickerDialog
              open={workflowDialogOpen}
              onOpenChange={setWorkflowDialogOpen}
              categoryFilter={workflowCategoryFilter}
              onCategoryFilterChange={setWorkflowCategoryFilter}
              categories={workflowCategories}
              availableWorkflows={availableWorkflows}
              onAddWorkflow={handleAddWorkflow}
            />
          </div>
          <WorkflowList
            workflowIds={transition.workflows}
            processes={processes}
            onRemove={handleRemoveWorkflow}
            onMoveUp={handleMoveWorkflowUp}
            onMoveDown={handleMoveWorkflowDown}
          />
        </div>
      </CardContent>
    </Card>
  );
}
