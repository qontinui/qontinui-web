"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Upload } from "lucide-react";
import { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowToolbarProps {
  workflow: Workflow;
  isEditingName: boolean;
  tempName: string;
  onTempNameChange: (name: string) => void;
  onRenameWorkflow: () => void;
  onStartEditingName: () => void;
  onCancelEditingName: () => void;
  onImportWorkflow: () => void;
  onExportWorkflow: () => void;
}

export function WorkflowToolbar({
  workflow,
  isEditingName,
  tempName,
  onTempNameChange,
  onRenameWorkflow,
  onStartEditingName,
  onCancelEditingName,
  onImportWorkflow,
  onExportWorkflow,
}: WorkflowToolbarProps) {
  return (
    <div className="border-b border-border-subtle bg-surface-raised/50 p-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {isEditingName ? (
          <div className="flex items-center gap-2">
            <Input
              value={tempName}
              onChange={(e) => onTempNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameWorkflow();
                if (e.key === "Escape") onCancelEditingName();
              }}
              className="text-lg font-bold bg-transparent border-border-default focus:border-brand-success h-8"
            />
            <Button
              size="sm"
              onClick={onRenameWorkflow}
              className="bg-brand-success text-black"
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEditingName}>
              Cancel
            </Button>
          </div>
        ) : (
          <h2
            className="text-lg font-bold text-brand-success cursor-pointer hover:underline"
            role="button"
            tabIndex={0}
            onClick={onStartEditingName}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStartEditingName();
              }
            }}
          >
            {workflow.name}
          </h2>
        )}

        <div className="text-sm text-text-muted">
          {workflow.actions.length} actions •{" "}
          {Object.keys(workflow.connections || {}).length} connections
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onImportWorkflow}
          className="border-border-default hover:border-brand-success hover:text-brand-success"
          data-tutorial-id="import-workflow"
        >
          <Upload className="w-4 h-4 mr-2" />
          Import
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExportWorkflow}
          className="border-border-default hover:border-brand-success hover:text-brand-success"
          data-tutorial-id="export-workflow"
        >
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>
    </div>
  );
}
