/**
 * CheckpointWorkflowActionProperties Component
 *
 * Configuration UI for CHECKPOINT_WORKFLOW action type.
 * Allows users to configure dynamic multi-session AI workflows with checkpoint-based progress tracking.
 */

import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import {
  CheckpointWorkflowActionConfig,
  WorkflowPhase,
} from "@/lib/action-schema/configs/ai-actions";
import {
  GitBranch,
  FileCheck,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Info,
  AlertCircle,
  Play,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * CheckpointWorkflowActionProperties - Properties component for CHECKPOINT_WORKFLOW action
 */
export function CheckpointWorkflowActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as CheckpointWorkflowActionConfig;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPhases, setShowPhases] = useState(true);

  // Helper to update nested checkpoint config
  const updateCheckpoint = (field: string, value: unknown) => {
    const checkpoint = config.checkpoint || { path: "", completionValue: 1 };
    updateConfig("checkpoint", { ...checkpoint, [field]: value });
  };

  // Helper to update phases array
  const updatePhase = (
    index: number,
    field: keyof WorkflowPhase,
    value: unknown
  ) => {
    const phases = [...(config.phases || [])];
    const currentPhase = phases[index] || { phase: index, name: "" };
    phases[index] = { ...currentPhase, [field]: value } as WorkflowPhase;
    updateConfig("phases", phases);
  };

  const addPhase = () => {
    const phases = config.phases || [];
    const nextPhase =
      phases.length > 0 ? Math.max(...phases.map((p) => p.phase)) + 1 : 1;
    updateConfig("phases", [
      ...phases,
      { phase: nextPhase, name: `Phase ${nextPhase}`, description: "" },
    ]);
  };

  const removePhase = (index: number) => {
    const phases = [...(config.phases || [])];
    phases.splice(index, 1);
    updateConfig("phases", phases);
  };

  return (
    <>
      {/* Info Box */}
      <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded">
        <GitBranch className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-900 dark:text-emerald-100">
          <p className="font-medium mb-1">Dynamic Multi-Session Workflow</p>
          <p>
            Run AI sessions that automatically continue until a target phase is
            reached. The AI updates a checkpoint file as it progresses, and new
            sessions are spawned automatically. Ideal for large tasks that would
            overflow a single context.
          </p>
        </div>
      </div>

      {/* Visual Phase Diagram */}
      {config.phases && config.phases.length > 0 && (
        <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Play className="w-3 h-3 text-gray-500" />
            <span className="text-xs text-gray-500">Workflow Phases</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {config.phases
              .sort((a, b) => a.phase - b.phase)
              .map((phase, idx) => (
                <React.Fragment key={phase.phase}>
                  <div
                    className={`px-2 py-1 rounded text-xs ${
                      phase.phase === config.checkpoint?.completionValue
                        ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                    title={phase.description}
                  >
                    {phase.phase === config.checkpoint?.completionValue && (
                      <CheckCircle2 className="w-3 h-3 inline mr-1" />
                    )}
                    {phase.name}
                  </div>
                  {idx < config.phases!.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-gray-400" />
                  )}
                </React.Fragment>
              ))}
          </div>
        </div>
      )}

      <Separator className="bg-gray-700" />

      {/* Checkpoint Configuration */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-emerald-500" />
          <Label className="text-sm font-medium">
            Checkpoint Configuration
          </Label>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-400">
            Checkpoint File Path *
          </Label>
          <Input
            type="text"
            value={config.checkpoint?.path || ""}
            onChange={(e) => updateCheckpoint("path", e.target.value)}
            placeholder="C:/project/.dev-logs/workflow-checkpoint.json"
            className="bg-transparent border-gray-700 font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            JSON file where the AI will track progress
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Phase Field</Label>
            <Input
              type="text"
              value={config.checkpoint?.phaseField || "current_phase"}
              onChange={(e) => updateCheckpoint("phaseField", e.target.value)}
              placeholder="current_phase"
              className="bg-transparent border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Completion Value *</Label>
            <Input
              type="number"
              min={1}
              value={config.checkpoint?.completionValue || 1}
              onChange={(e) =>
                updateCheckpoint(
                  "completionValue",
                  parseInt(e.target.value) || 1
                )
              }
              className="bg-transparent border-gray-700"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs text-gray-400">Reset on Start</Label>
            <p className="text-xs text-gray-500">
              Delete checkpoint when workflow starts
            </p>
          </div>
          <Switch
            checked={config.checkpoint?.resetOnStart !== false}
            onCheckedChange={(checked) =>
              updateCheckpoint("resetOnStart", checked)
            }
          />
        </div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Prompts */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Initial Prompt *</Label>
          <Textarea
            value={config.initialPrompt || ""}
            onChange={(e) => updateConfig("initialPrompt", e.target.value)}
            placeholder={`# Multi-Phase Workflow

Read the checkpoint file at {checkpoint_path}.
If it doesn't exist, create it and start at phase 0.

## Phases
1. Analysis - Analyze the codebase
2. Implementation - Make changes
3. Verification - Run tests

Complete 1-2 phases per session, update the checkpoint, then exit.`}
            className="bg-transparent border-gray-700 min-h-[150px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            Prompt for the first AI session. Include checkpoint instructions and
            phase descriptions.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Continuation Prompt</Label>
          <Textarea
            value={config.continuationPrompt || ""}
            onChange={(e) =>
              updateConfig("continuationPrompt", e.target.value || undefined)
            }
            placeholder="Continue the workflow. Read the checkpoint file, resume from the current phase, complete 1-2 phases, update the checkpoint, then exit."
            className="bg-transparent border-gray-700 min-h-[80px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            Prompt for continuation sessions. If empty, uses a default that
            references the checkpoint.
          </p>
        </div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Phase Definitions */}
      <Collapsible open={showPhases} onOpenChange={setShowPhases}>
        <CollapsibleTrigger className="flex items-center justify-between w-full text-sm">
          <div className="flex items-center gap-2 text-gray-400 hover:text-gray-300">
            {showPhases ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Phase Definitions
            <span className="text-xs text-gray-500">
              ({config.phases?.length || 0})
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              addPhase();
            }}
            className="h-6 px-2 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Phase
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 mt-3">
          <p className="text-xs text-gray-500">
            Define phases for visual clarity. The AI will update the checkpoint
            as it completes each phase.
          </p>
          {(config.phases || []).map((phase, index) => (
            <div
              key={index}
              className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded border border-gray-200 dark:border-gray-700 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={phase.phase}
                    onChange={(e) =>
                      updatePhase(index, "phase", parseInt(e.target.value) || 0)
                    }
                    className="w-16 h-7 text-xs bg-transparent border-gray-700"
                  />
                  <Input
                    type="text"
                    value={phase.name}
                    onChange={(e) => updatePhase(index, "name", e.target.value)}
                    placeholder="Phase name"
                    className="h-7 text-xs bg-transparent border-gray-700"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removePhase(index)}
                  className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <Input
                type="text"
                value={phase.description || ""}
                onChange={(e) =>
                  updatePhase(index, "description", e.target.value)
                }
                placeholder="Description (optional)"
                className="h-7 text-xs bg-transparent border-gray-700"
              />
            </div>
          ))}
          {(!config.phases || config.phases.length === 0) && (
            <div className="text-center py-4 text-xs text-gray-500">
              No phases defined. Add phases to visualize workflow structure.
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Separator className="bg-gray-700" />

      {/* Session Limits */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Max Sessions</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={config.maxSessions || 10}
            onChange={(e) =>
              updateConfig("maxSessions", parseInt(e.target.value) || 10)
            }
            className="bg-transparent border-gray-700"
          />
          <p className="text-xs text-gray-500">Prevents infinite loops</p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">
            Max Iterations/Session
          </Label>
          <Input
            type="number"
            min={1}
            max={200}
            value={config.maxIterationsPerSession || 50}
            onChange={(e) =>
              updateConfig(
                "maxIterationsPerSession",
                parseInt(e.target.value) || 50
              )
            }
            className="bg-transparent border-gray-700"
          />
          <p className="text-xs text-gray-500">Claude CLI iterations</p>
        </div>
      </div>

      {/* Output Variable */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Output Variable</Label>
        <Input
          type="text"
          value={config.outputVariable || ""}
          onChange={(e) =>
            updateConfig("outputVariable", e.target.value || undefined)
          }
          placeholder="workflow_result"
          className="bg-transparent border-gray-700"
        />
        <p className="text-xs text-gray-500">
          Store final results in this workflow variable
        </p>
      </div>

      <Separator className="bg-gray-700" />

      {/* Advanced Configuration */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300">
          {showAdvanced ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Advanced Configuration
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-3">
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Working Directory</Label>
            <Input
              type="text"
              value={config.workingDirectory || ""}
              onChange={(e) =>
                updateConfig("workingDirectory", e.target.value || undefined)
              }
              placeholder="/path/to/project"
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">
              Session Timeout (ms)
            </Label>
            <Input
              type="number"
              min={60000}
              max={3600000}
              value={config.sessionTimeout || 600000}
              onChange={(e) =>
                updateConfig(
                  "sessionTimeout",
                  parseInt(e.target.value) || 600000
                )
              }
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              Max time per session (default: 10 minutes)
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Description</Label>
            <Textarea
              value={config.description || ""}
              onChange={(e) =>
                updateConfig("description", e.target.value || undefined)
              }
              placeholder="Describe what this workflow does..."
              className="bg-transparent border-gray-700 min-h-[60px]"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator className="bg-gray-700" />

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />

      {/* How It Works */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 dark:text-blue-100">
          <p className="font-medium mb-1">How Checkpoint Workflows Work</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>First session runs with the initial prompt</li>
            <li>AI works and updates the checkpoint file when ready</li>
            <li>When session ends, workflow checks the checkpoint</li>
            <li>If not complete, spawns continuation session immediately</li>
            <li>Repeats until phase reaches completion value</li>
          </ol>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-700 rounded">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 dark:text-amber-200">
          <p className="font-medium mb-1">Checkpoint File Required</p>
          <p>
            The AI must write a JSON file with the phase field for the workflow
            to progress. Include clear instructions in your prompt about the
            checkpoint format and location.
          </p>
        </div>
      </div>
    </>
  );
}
