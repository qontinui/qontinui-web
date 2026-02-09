"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";

const TEMPLATE_VARIABLES = [
  { name: "{{SESSION_ID}}", description: "Current session number" },
  { name: "{{ITERATION}}", description: "Current iteration number" },
  { name: "{{MAX_ITERATIONS}}", description: "Maximum iterations" },
  { name: "{{GOAL}}", description: "Workflow goal/description" },
  { name: "{{EXECUTION_STEPS}}", description: "Compiled execution steps" },
  { name: "{{WORKSPACE_ESCAPED}}", description: "Escaped workspace path" },
];

interface PromptTemplateEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PromptTemplateEditor({
  isOpen,
  onClose,
}: PromptTemplateEditorProps) {
  const { state, updateWorkflow } = useWorkflowBuilder();
  const [template, setTemplate] = useState(
    state.workflow.prompt_template ?? ""
  );

  const handleSave = () => {
    updateWorkflow({ prompt_template: template || null });
    onClose();
  };

  const handleClear = () => {
    setTemplate("");
    updateWorkflow({ prompt_template: null });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Custom Prompt Template</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Set a custom developer prompt template for this workflow. Leave
            empty to use the global default.
          </p>

          <Textarea
            className="min-h-[300px] font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Custom prompt template... Leave empty to use default."
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              Available Variables
            </label>
            <div className="grid grid-cols-2 gap-1">
              {TEMPLATE_VARIABLES.map((v) => (
                <div key={v.name} className="flex items-center gap-2 text-xs">
                  <code className="px-1 py-0.5 bg-zinc-800 rounded text-blue-400">
                    {v.name}
                  </code>
                  <span className="text-zinc-500">{v.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-2 border-t border-zinc-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-red-400"
          >
            Clear Template
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
