/**
 * Workflow Properties Component
 *
 * Displays and edits workflow-level properties when no nodes are selected:
 * - Workflow metadata (name, version, description, author)
 * - Workflow settings (timeout, error handling, parallel execution)
 * - Variables (global, process-level)
 * - Tags
 * - Statistics
 */

"use client";

import React, { useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Settings,
  Database,
  Tag,
  BarChart3,
  Plus,
  X,
  Info,
  GitBranch,
  Repeat,
} from "lucide-react";
import { hasConditionalLogic, hasLoops } from "@/lib/workflow-validator";

// ============================================================================
// Workflow Properties Component
// ============================================================================

export interface WorkflowPropertiesProps {
  className?: string;
}

export const WorkflowProperties: React.FC<WorkflowPropertiesProps> = ({
  className = "",
}) => {
  const workflow = useCanvasStore((state) => state.workflow);

  const [newTag, setNewTag] = useState("");
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [newVarScope, setNewVarScope] = useState<
    "local" | "process" | "global"
  >("local");

  if (!workflow) {
    return (
      <div className={`p-4 text-gray-400 text-sm ${className}`}>
        No workflow loaded
      </div>
    );
  }

  const updateMetadata = (key: string, value: any) => {
    // This would update workflow in canvas store
    // For now, we'll just log
    console.log("Update metadata:", key, value);
  };

  const updateSettings = (key: string, value: any) => {
    console.log("Update settings:", key, value);
  };

  const updateVariable = (scope: string, name: string, value: any) => {
    console.log("Update variable:", scope, name, value);
  };

  const addTag = () => {
    if (newTag.trim()) {
      console.log("Add tag:", newTag);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    console.log("Remove tag:", tag);
  };

  const addVariable = () => {
    if (newVarName.trim()) {
      updateVariable(newVarScope, newVarName, newVarValue);
      setNewVarName("");
      setNewVarValue("");
    }
  };

  const removeVariable = (scope: string, name: string) => {
    console.log("Remove variable:", scope, name);
  };

  // Calculate statistics
  const actionCount = workflow.actions.length;
  const connectionCount = Object.values(workflow.connections).reduce(
    (sum, conn) => {
      return (
        sum +
        Object.values(conn).reduce((s, outputs) => {
          return (
            s + (outputs?.reduce((ss, conns) => ss + conns.length, 0) || 0)
          );
        }, 0)
      );
    },
    0
  );

  return (
    <div className={`overflow-y-auto ${className}`}>
      <div className="p-4 space-y-6">
        {/* Metadata Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-200">
              Workflow Metadata
            </h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Name</Label>
              <Input
                value={workflow.name}
                onChange={(e) => updateMetadata("name", e.target.value)}
                className="bg-transparent border-gray-700 text-gray-200"
                placeholder="My Workflow"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Version</Label>
              <Input
                value={workflow.version}
                onChange={(e) => updateMetadata("version", e.target.value)}
                className="bg-transparent border-gray-700 text-gray-200"
                placeholder="1.0.0"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Description</Label>
              <Textarea
                value={workflow.metadata?.description || ""}
                onChange={(e) => updateMetadata("description", e.target.value)}
                className="bg-transparent border-gray-700 text-gray-200 min-h-[80px]"
                placeholder="Describe what this workflow does..."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Author</Label>
              <Input
                value={workflow.metadata?.author || ""}
                onChange={(e) => updateMetadata("author", e.target.value)}
                className="bg-transparent border-gray-700 text-gray-200"
                placeholder="Your name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-gray-400">Created</Label>
                <div className="text-sm text-gray-300">
                  {workflow.metadata?.created
                    ? new Date(workflow.metadata.created).toLocaleDateString()
                    : "Unknown"}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-gray-400">Updated</Label>
                <div className="text-sm text-gray-300">
                  {workflow.metadata?.updated
                    ? new Date(workflow.metadata.updated).toLocaleDateString()
                    : "Unknown"}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Settings Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-green-400" />
            <h3 className="text-sm font-semibold text-gray-200">
              Workflow Settings
            </h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Timeout (ms)</Label>
              <Input
                type="number"
                value={workflow.settings?.timeout || 0}
                onChange={(e) =>
                  updateSettings("timeout", Number(e.target.value))
                }
                className="bg-transparent border-gray-700 text-gray-200"
                placeholder="0 (no timeout)"
              />
              <p className="text-xs text-gray-500">
                Maximum time for entire workflow execution
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Retries</Label>
              <Input
                type="number"
                value={workflow.settings?.maxRetries || 0}
                onChange={(e) =>
                  updateSettings("maxRetries", Number(e.target.value))
                }
                className="bg-transparent border-gray-700 text-gray-200"
                min="0"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Retry Delay (ms)</Label>
              <Input
                type="number"
                value={workflow.settings?.retryDelay || 1000}
                onChange={(e) =>
                  updateSettings("retryDelay", Number(e.target.value))
                }
                className="bg-transparent border-gray-700 text-gray-200"
                min="0"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Log Level</Label>
              <Select
                value={workflow.settings?.logLevel || "info"}
                onValueChange={(value) => updateSettings("logLevel", value)}
              >
                <SelectTrigger className="bg-transparent border-gray-700 text-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#27272A] border-gray-700">
                  <SelectItem value="debug">Debug</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs text-gray-400">
                  Parallel Execution
                </Label>
                <p className="text-xs text-gray-500">
                  Enable parallel branches
                </p>
              </div>
              <Switch
                checked={workflow.settings?.enableParallelExecution || false}
                onCheckedChange={(checked) =>
                  updateSettings("enableParallelExecution", checked)
                }
              />
            </div>
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Variables Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-gray-200">Variables</h3>
          </div>

          <div className="space-y-4">
            {/* Add Variable Form */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select
                  value={newVarScope}
                  onValueChange={(v: any) => setNewVarScope(v)}
                >
                  <SelectTrigger className="w-[120px] bg-transparent border-gray-700 text-gray-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#27272A] border-gray-700">
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="process">Workflow</SelectItem>
                    <SelectItem value="global">Global</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  placeholder="Variable name"
                  className="flex-1 bg-transparent border-gray-700 text-gray-200"
                />
              </div>
              <div className="flex gap-2">
                <Input
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-transparent border-gray-700 text-gray-200"
                />
                <Button
                  size="sm"
                  onClick={addVariable}
                  disabled={!newVarName.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Variable Lists */}
            {["local", "process", "global"].map((scope) => {
              const variables =
                workflow.variables?.[scope as keyof typeof workflow.variables];
              if (!variables || Object.keys(variables).length === 0)
                return null;

              return (
                <div key={scope} className="space-y-2">
                  <Label className="text-xs text-gray-400 capitalize">
                    {scope} Variables
                  </Label>
                  <div className="space-y-1">
                    {Object.entries(variables).map(([name, value]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between p-2 rounded bg-gray-800/50 border border-gray-700"
                      >
                        <div className="flex-1">
                          <div className="text-xs font-mono text-gray-300">
                            {name}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {JSON.stringify(value)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeVariable(scope, name)}
                          className="h-6 w-6 p-0 hover:bg-red-900/20"
                        >
                          <X className="w-3 h-3 text-red-400" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Tags Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-gray-200">Tags</h3>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                placeholder="Add tag..."
                className="flex-1 bg-transparent border-gray-700 text-gray-200"
              />
              <Button
                size="sm"
                onClick={addTag}
                disabled={!newTag.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {workflow.tags && workflow.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {workflow.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="bg-gray-700 text-gray-200 pr-1"
                  >
                    {tag}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeTag(tag)}
                      className="h-4 w-4 p-0 ml-1 hover:bg-transparent"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Graph Execution Features */}
        {workflow.connections &&
          Object.keys(workflow.connections).length > 0 && (
            <>
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <GitBranch className="w-4 h-4 text-orange-400" />
                  <h3 className="text-sm font-semibold text-gray-200">
                    Graph Execution
                  </h3>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded bg-blue-900/20 border border-blue-700/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant="secondary"
                        className="bg-blue-600 text-white"
                      >
                        Graph Execution Enabled
                      </Badge>
                      <span className="text-xs text-gray-400">
                        {Object.keys(workflow.connections).length} actions with
                        connections
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-2">
                      {hasConditionalLogic(
                        workflow as import("@/lib/export-schema").Workflow
                      ) && (
                        <Badge
                          variant="outline"
                          className="border-green-600 text-green-400"
                        >
                          <GitBranch className="w-3 h-3 mr-1" />
                          Conditional Branching
                        </Badge>
                      )}

                      {hasLoops(
                        workflow as import("@/lib/export-schema").Workflow
                      ) && (
                        <Badge
                          variant="outline"
                          className="border-yellow-600 text-yellow-400"
                        >
                          <Repeat className="w-3 h-3 mr-1" />
                          Contains Loops
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-gray-400 space-y-1">
                    <p>
                      <strong>Conditional Branching:</strong> Uses success/error
                      paths to control flow
                    </p>
                    <p>
                      <strong>Loops:</strong> May contain cycles - ensure proper
                      exit conditions
                    </p>
                  </div>
                </div>
              </section>

              <Separator className="bg-gray-700" />
            </>
          )}

        {/* Statistics Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-gray-200">Statistics</h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded bg-gray-800/50 border border-gray-700">
              <div className="text-2xl font-bold text-blue-400">
                {actionCount}
              </div>
              <div className="text-xs text-gray-400">Actions</div>
            </div>

            <div className="p-3 rounded bg-gray-800/50 border border-gray-700">
              <div className="text-2xl font-bold text-green-400">
                {connectionCount}
              </div>
              <div className="text-xs text-gray-400">Connections</div>
            </div>

            <div className="p-3 rounded bg-gray-800/50 border border-gray-700">
              <div className="text-2xl font-bold text-purple-400">
                {Object.keys(workflow.variables?.local || {}).length}
              </div>
              <div className="text-xs text-gray-400">Variables</div>
            </div>

            <div className="p-3 rounded bg-gray-800/50 border border-gray-700">
              <div className="text-2xl font-bold text-yellow-400">
                {workflow.tags?.length || 0}
              </div>
              <div className="text-xs text-gray-400">Tags</div>
            </div>
          </div>

          <div className="mt-4 p-3 rounded bg-blue-900/20 border border-blue-700/30">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-gray-300">
                <strong>Estimated execution time:</strong> Varies based on
                conditions and retries. Run validation for detailed analysis.
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
