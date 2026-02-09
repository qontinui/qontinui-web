"use client";

import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  McpCallStep,
  ApiVariableExtraction,
} from "@/types/unified-workflow";

interface McpCallStepEditorProps {
  isOpen: boolean;
  onClose: () => void;
  step: McpCallStep;
  onSave: (updates: Partial<McpCallStep>) => void;
}

export function McpCallStepEditor({
  isOpen,
  onClose,
  step,
  onSave,
}: McpCallStepEditorProps) {
  const [serverId, setServerId] = useState(step.server_id);
  const [serverName, setServerName] = useState(step.server_name ?? "");
  const [toolName, setToolName] = useState(step.tool_name);
  const [toolDescription, setToolDescription] = useState(
    step.tool_description ?? ""
  );
  const [argumentsJson, setArgumentsJson] = useState(
    step.arguments ? JSON.stringify(step.arguments, null, 2) : ""
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    step.timeout_seconds ?? 30
  );
  const [extractions, setExtractions] = useState<ApiVariableExtraction[]>(
    step.extractions ?? []
  );

  const handleSave = () => {
    let parsedArgs: Record<string, unknown> | undefined;
    if (argumentsJson.trim()) {
      try {
        parsedArgs = JSON.parse(argumentsJson);
      } catch {
        parsedArgs = undefined;
      }
    }

    onSave({
      server_id: serverId,
      server_name: serverName || undefined,
      tool_name: toolName,
      tool_description: toolDescription || undefined,
      arguments: parsedArgs,
      timeout_seconds: timeoutSeconds,
      extractions: extractions.length > 0 ? extractions : undefined,
    });
    onClose();
  };

  const addExtraction = () => {
    setExtractions([...extractions, { variable_name: "", json_path: "" }]);
  };

  const updateExtraction = (
    index: number,
    updates: Partial<ApiVariableExtraction>
  ) => {
    const next = [...extractions];
    next[index] = { ...next[index], ...updates } as ApiVariableExtraction;
    setExtractions(next);
  };

  const removeExtraction = (index: number) => {
    setExtractions(extractions.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>MCP Call Editor</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Server ID
                </label>
                <Input
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Server Name
                </label>
                <Input
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder="Display name"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Tool Name
              </label>
              <Input
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Tool Description
              </label>
              <Input
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                placeholder="What this tool does"
                value={toolDescription}
                onChange={(e) => setToolDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Arguments (JSON)
              </label>
              <Textarea
                className="min-h-[100px] font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                placeholder='{"key": "value"}'
                value={argumentsJson}
                onChange={(e) => setArgumentsJson(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Timeout (seconds)
              </label>
              <Input
                type="number"
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                value={timeoutSeconds}
                onChange={(e) =>
                  setTimeoutSeconds(parseInt(e.target.value) || 30)
                }
              />
            </div>

            {/* Variable Extractions */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-400">
                  Variable Extractions
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={addExtraction}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              {extractions.map((ext, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    placeholder="Variable name"
                    value={ext.variable_name}
                    onChange={(e) =>
                      updateExtraction(i, { variable_name: e.target.value })
                    }
                  />
                  <Input
                    className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    placeholder="$.data.id"
                    value={ext.json_path}
                    onChange={(e) =>
                      updateExtraction(i, { json_path: e.target.value })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-400"
                    onClick={() => removeExtraction(i)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
