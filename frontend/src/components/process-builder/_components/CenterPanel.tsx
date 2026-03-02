"use client";

import { Input } from "@/components/ui/input";
import { Play } from "lucide-react";
import { ActionEditor } from "@/components/action-editor";
import { ProcessOptionsSection } from "./ProcessOptionsSection";
import type { Workflow, Action } from "@/lib/action-schema/action-types";

interface Screenshot {
  id: string;
  name: string;
}

interface State {
  id: string;
  name: string;
}

interface CenterPanelProps {
  selectedProcess: Workflow | null;
  selectedAction: Action | null;
  optionsExpanded: boolean;
  allCategories: string[];
  screenshots: Screenshot[];
  states: State[];
  onOptionsToggle: (open: boolean) => void;
  onUpdateProcess: (updated: Workflow) => void;
  onSelectAction: (action: Action | null) => void;
  onCreateOutgoingTransition: () => void;
  onCreateIncomingTransition: () => void;
}

export function CenterPanel({
  selectedProcess,
  selectedAction,
  optionsExpanded,
  allCategories,
  screenshots,
  states,
  onOptionsToggle,
  onUpdateProcess,
  onSelectAction,
  onCreateOutgoingTransition,
  onCreateIncomingTransition,
}: CenterPanelProps) {
  if (!selectedProcess) {
    return (
      <div className="flex-[3] min-w-[400px] p-6 overflow-y-auto">
        <div className="flex items-center justify-center h-full text-text-muted">
          <div className="text-center">
            <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Select a process to edit</p>
            <p className="text-sm">or create a new one to get started</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-[3] min-w-[400px] p-6 overflow-y-auto">
      <div className="space-y-6">
        <div className="space-y-4">
          <Input
            value={selectedProcess.name}
            onChange={(e) => {
              const updated = { ...selectedProcess, name: e.target.value };
              onUpdateProcess(updated);
            }}
            className="text-xl font-bold bg-transparent border-border-default focus:border-brand-primary"
            placeholder="Process name"
          />

          <ProcessOptionsSection
            selectedProcess={selectedProcess}
            optionsExpanded={optionsExpanded}
            allCategories={allCategories}
            screenshots={screenshots}
            states={states}
            onOptionsToggle={onOptionsToggle}
            onUpdateProcess={onUpdateProcess}
            onCreateOutgoingTransition={onCreateOutgoingTransition}
            onCreateIncomingTransition={onCreateIncomingTransition}
          />
        </div>

        <ActionEditor
          process={
            {
              id: selectedProcess.id,
              name: selectedProcess.name,
              description: selectedProcess.description || "",
              actions: selectedProcess.actions,
            } as unknown as Parameters<typeof ActionEditor>[0]["process"]
          }
          selectedAction={
            selectedAction as Parameters<
              typeof ActionEditor
            >[0]["selectedAction"]
          }
          onSelectAction={(action) => {
            // Convert ActionEditor's Action to our Action type
            onSelectAction(action as unknown as Action);
          }}
          onUpdateProcess={(process) => {
            // Convert ActionEditor's Process back to Workflow
            const updatedWorkflow: Workflow = {
              ...selectedProcess,
              name: process.name,
              description: process.description,
              actions: process.actions as unknown as Action[],
            };
            onUpdateProcess(updatedWorkflow);
          }}
        />
      </div>
    </div>
  );
}
