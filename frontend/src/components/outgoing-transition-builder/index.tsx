"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft } from "lucide-react";

import type { OutgoingTransitionBuilderProps } from "./types";
import { useTransitionBuilderState } from "./_hooks/use-transition-builder-state";
import { FromStateSelector } from "./_components/FromStateSelector";
import { StateColumns } from "./_components/StateColumns";
import { WorkflowSelector } from "./_components/WorkflowSelector";
import { DialogFooter } from "./_components/DialogFooter";

export type { OutgoingTransitionBuilderProps };

export function OutgoingTransitionBuilder(
  props: OutgoingTransitionBuilderProps = {}
) {
  const { preselectedWorkflow, preselectedOriginState } = props;

  const {
    states,
    workflows,
    open,
    handleOpenChange,
    fromState,
    staysVisible,
    activateStates,
    deactivateStates,
    selectedWorkflows,
    workflowCategoryFilter,
    availableStates,
    handleFromStateChange,
    handleStaysVisibleChange,
    moveToActivate,
    moveToDeactivate,
    moveToAvailable,
    setWorkflowCategoryFilter,
    addSelectedWorkflow,
    removeSelectedWorkflow,
    handleCreate,
  } = useTransitionBuilderState(props);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!preselectedWorkflow && !preselectedOriginState && (
        <DialogTrigger asChild>
          <Button className="w-full bg-brand-success hover:bg-brand-success/80 text-black">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Create Outgoing Transition
          </Button>
        </DialogTrigger>
      )}

      <DialogContent
        className="bg-surface-raised border-border-default max-h-[90vh] flex flex-col"
        style={{ maxWidth: "1400px", width: "95vw" }}
      >
        <DialogHeader>
          <DialogTitle className="text-brand-success">
            Create Outgoing Transition
          </DialogTitle>
          <DialogDescription className="text-text-muted text-sm">
            Define a transition from one state to multiple target states
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 px-1">
          <FromStateSelector
            states={states}
            fromState={fromState}
            staysVisible={staysVisible}
            onFromStateChange={handleFromStateChange}
            onStaysVisibleChange={handleStaysVisibleChange}
          />

          <StateColumns
            states={states}
            fromState={fromState}
            availableStates={availableStates}
            activateStates={activateStates}
            deactivateStates={deactivateStates}
            onMoveToActivate={moveToActivate}
            onMoveToDeactivate={moveToDeactivate}
            onMoveToAvailable={moveToAvailable}
          />

          <WorkflowSelector
            workflows={workflows}
            selectedWorkflows={selectedWorkflows}
            workflowCategoryFilter={workflowCategoryFilter}
            onCategoryFilterChange={setWorkflowCategoryFilter}
            onAddWorkflow={addSelectedWorkflow}
            onRemoveWorkflow={removeSelectedWorkflow}
          />
        </div>

        <DialogFooter
          onCancel={() => handleOpenChange(false)}
          onCreate={handleCreate}
        />
      </DialogContent>
    </Dialog>
  );
}
