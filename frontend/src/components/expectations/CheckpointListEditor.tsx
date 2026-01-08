"use client";

import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Flag, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import type { CheckpointDefinition } from "@/lib/expectations/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface CheckpointListEditorProps {
  checkpoints: Record<string, CheckpointDefinition> | undefined;
  onChange: (checkpoints: Record<string, CheckpointDefinition>) => void;
}

/**
 * Editor for workflow checkpoint definitions
 *
 * Manages named checkpoints with:
 * - Screenshot requirements
 * - OCR assertions
 * - Claude review instructions
 * - Timing configuration
 */
export function CheckpointListEditor({
  checkpoints,
  onChange,
}: CheckpointListEditorProps) {
  const [newCheckpointName, setNewCheckpointName] = useState("");
  const [expandedCheckpoints, setExpandedCheckpoints] = useState<Set<string>>(
    new Set()
  );

  const current = checkpoints || {};
  const checkpointNames = Object.keys(current);

  const toggleExpanded = (name: string) => {
    const newExpanded = new Set(expandedCheckpoints);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedCheckpoints(newExpanded);
  };

  const addCheckpoint = () => {
    if (!newCheckpointName.trim()) return;
    if (current[newCheckpointName]) return;

    onChange({
      ...current,
      [newCheckpointName]: {
        screenshot_required: true,
        max_wait_ms: 5000,
        retry_interval_ms: 500,
      },
    });
    setExpandedCheckpoints(
      new Set([...expandedCheckpoints, newCheckpointName])
    );
    setNewCheckpointName("");
  };

  const removeCheckpoint = (name: string) => {
    const updated = { ...current };
    delete updated[name];
    onChange(updated);
    const newExpanded = new Set(expandedCheckpoints);
    newExpanded.delete(name);
    setExpandedCheckpoints(newExpanded);
  };

  const updateCheckpoint = (
    name: string,
    updates: Partial<CheckpointDefinition>
  ) => {
    onChange({
      ...current,
      [name]: {
        ...current[name],
        ...updates,
      },
    });
  };

  const addClaudeReview = (name: string) => {
    const checkpoint = current[name];
    if (!checkpoint) return;
    const reviews = checkpoint.claude_review || [];
    updateCheckpoint(name, {
      claude_review: [...reviews, ""],
    });
  };

  const updateClaudeReview = (
    checkpointName: string,
    index: number,
    value: string
  ) => {
    const checkpoint = current[checkpointName];
    if (!checkpoint) return;
    const reviews = [...(checkpoint.claude_review || [])];
    reviews[index] = value;
    updateCheckpoint(checkpointName, { claude_review: reviews });
  };

  const removeClaudeReview = (checkpointName: string, index: number) => {
    const checkpoint = current[checkpointName];
    if (!checkpoint) return;
    const reviews = [...(checkpoint.claude_review || [])];
    reviews.splice(index, 1);
    updateCheckpoint(checkpointName, { claude_review: reviews });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 text-brand-primary">
        <Flag className="w-4 h-4" />
        <h3 className="text-sm font-medium">Checkpoints</h3>
      </div>

      {/* Add New Checkpoint */}
      <Card className="p-4 border-border-default bg-surface-raised/50 space-y-3">
        <Label className="text-xs text-text-muted">Add Checkpoint</Label>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Enter checkpoint name"
            value={newCheckpointName}
            onChange={(e) => setNewCheckpointName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCheckpoint();
              }
            }}
            className="bg-transparent border-border-default text-sm flex-1"
          />
          <Button
            size="sm"
            onClick={addCheckpoint}
            disabled={!newCheckpointName.trim() || !!current[newCheckpointName]}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      {/* Checkpoint List */}
      {checkpointNames.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">
          <Flag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No checkpoints defined</p>
          <p className="text-xs">
            Add checkpoints to validate workflow execution
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {checkpointNames.map((name) => {
            const checkpoint = current[name];
            // Skip if checkpoint doesn&apos;t exist (shouldn&apos;t happen, but for type safety)
            if (!checkpoint) return null;
            const isExpanded = expandedCheckpoints.has(name);

            return (
              <Collapsible key={name} open={isExpanded}>
                <Card className="border-border-default bg-surface-raised/50">
                  <CollapsibleTrigger
                    onClick={() => toggleExpanded(name)}
                    className="w-full"
                  >
                    <div className="p-4 flex items-center justify-between hover:bg-surface-raised/30 transition-colors">
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-text-muted" />
                        )}
                        <Flag className="w-4 h-4 text-brand-primary" />
                        <span className="text-sm font-medium text-text-secondary">
                          {name}
                        </span>
                        {checkpoint.screenshot_required && (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-blue-500/20 text-blue-300 border-blue-500/30"
                          >
                            Screenshot
                          </Badge>
                        )}
                        {checkpoint.claude_review &&
                          checkpoint.claude_review.length > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-purple-500/20 text-purple-300 border-purple-500/30"
                            >
                              Claude Review
                            </Badge>
                          )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCheckpoint(name);
                        }}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-4 border-t border-border-default pt-4">
                      {/* Description */}
                      <div className="space-y-2">
                        <Label className="text-xs text-text-muted">
                          Description
                        </Label>
                        <Textarea
                          value={checkpoint.description || ""}
                          onChange={(e) =>
                            updateCheckpoint(name, {
                              description: e.target.value,
                            })
                          }
                          placeholder="What does this checkpoint validate?"
                          className="bg-transparent border-border-default text-sm min-h-16"
                        />
                      </div>

                      {/* Screenshot Required */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-xs text-text-muted">
                            Screenshot Required
                          </Label>
                          <p className="text-xs text-text-muted">
                            Capture screenshot at this checkpoint
                          </p>
                        </div>
                        <Switch
                          checked={checkpoint.screenshot_required ?? true}
                          onCheckedChange={(checked) =>
                            updateCheckpoint(name, {
                              screenshot_required: checked,
                            })
                          }
                        />
                      </div>

                      {/* Timing Configuration */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-text-muted">
                            Max Wait (ms)
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="100"
                            value={checkpoint.max_wait_ms ?? 5000}
                            onChange={(e) =>
                              updateCheckpoint(name, {
                                max_wait_ms: parseInt(e.target.value),
                              })
                            }
                            className="bg-transparent border-border-default text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-text-muted">
                            Retry Interval (ms)
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="100"
                            value={checkpoint.retry_interval_ms ?? 500}
                            onChange={(e) =>
                              updateCheckpoint(name, {
                                retry_interval_ms: parseInt(e.target.value),
                              })
                            }
                            className="bg-transparent border-border-default text-sm"
                          />
                        </div>
                      </div>

                      {/* Claude Review Instructions */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-text-muted">
                            Claude Review Instructions
                          </Label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => addClaudeReview(name)}
                            className="h-6 text-xs"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add
                          </Button>
                        </div>
                        {checkpoint.claude_review &&
                          checkpoint.claude_review.length > 0 && (
                            <div className="space-y-2">
                              {checkpoint.claude_review.map(
                                (instruction, i) => (
                                  <div key={i} className="flex gap-2">
                                    <Textarea
                                      value={instruction}
                                      onChange={(e) =>
                                        updateClaudeReview(
                                          name,
                                          i,
                                          e.target.value
                                        )
                                      }
                                      placeholder="Instruction for Claude to review the checkpoint..."
                                      className="bg-transparent border-border-default text-sm min-h-20"
                                    />
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        removeClaudeReview(name, i)
                                      }
                                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8 p-0"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        <p className="text-xs text-text-muted">
                          Natural language instructions for Claude to review the
                          checkpoint screenshot
                        </p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
