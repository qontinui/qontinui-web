"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { SaveWorkflowArtifactStep } from "@/types/unified-workflow";

interface SaveWorkflowArtifactConfigProps {
  step: SaveWorkflowArtifactStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function SaveWorkflowArtifactConfig({
  step,
  onUpdate,
}: SaveWorkflowArtifactConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Artifact Input Path
        </label>
        <Input
          className="font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="{{artifact_dir}}/workflow.json"
          value={step.artifact_input_path}
          onChange={(e) => onUpdate({ artifact_input_path: e.target.value })}
        />
        <p className="text-xs text-zinc-500 mt-1">
          Path to the generated workflow JSON file to save to the library.
        </p>
      </div>
      <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-md">
        <p className="text-xs text-zinc-500">
          This step reads a workflow JSON file from the specified path and saves
          it to the workflow library. The file must contain a valid workflow
          definition.
        </p>
      </div>
    </div>
  );
}
