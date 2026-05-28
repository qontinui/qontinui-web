"use client";

import React, { useState } from "react";
import { Transition, State } from "@/contexts/automation-context/types";
import { Workflow } from "@/lib/action-schema/action-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Save, Trash2, Edit } from "lucide-react";
import { COLORS } from "./types";

interface TransitionDetailsPanelProps {
  transition: Transition | null;
  states: State[];
  workflows: Workflow[];
  onUpdate: (transition: Transition, updates: Partial<Transition>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function TransitionDetailsPanel({
  transition,
  states,
  workflows,
  onUpdate,
  onDelete,
  onClose,
}: TransitionDetailsPanelProps) {
  const [localTransition, setLocalTransition] = useState(transition);
  const [prevTransition, setPrevTransition] = useState(transition);
  if (transition !== prevTransition) {
    setPrevTransition(transition);
    setLocalTransition(transition);
  }

  if (!localTransition) {
    return (
      <Card className="border-border-default bg-surface-raised h-full">
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center text-text-muted">
            <Edit className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Select a transition to edit</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleSave = () => {
    onUpdate(transition!, localTransition);
  };

  return (
    <Card className="border-border-default bg-surface-raised h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-brand-primary">
            Transition Editor
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto space-y-4">
        {/* Basic Info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-text-muted">Type</Label>
            <Badge
              variant="outline"
              style={{
                borderColor:
                  localTransition.type === "OutgoingTransition"
                    ? COLORS.success
                    : COLORS.primary,
              }}
            >
              {localTransition.type === "OutgoingTransition"
                ? "Outgoing"
                : "Incoming"}
            </Badge>
          </div>

          {localTransition.type === "OutgoingTransition" && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">From State</Label>
                <Select
                  value={localTransition.fromState}
                  onValueChange={(value) =>
                    setLocalTransition({ ...localTransition, fromState: value })
                  }
                >
                  <SelectTrigger className="bg-transparent border-border-default">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={localTransition.staysVisible}
                  onCheckedChange={(checked) =>
                    setLocalTransition({
                      ...localTransition,
                      staysVisible: !!checked,
                    })
                  }
                />
                <Label className="text-xs">Origin state stays visible</Label>
              </div>
            </>
          )}

          {localTransition.type === "IncomingTransition" && (
            <div className="space-y-2">
              <Label className="text-xs">To State</Label>
              <Select
                value={localTransition.toState}
                onValueChange={(value) =>
                  setLocalTransition({ ...localTransition, toState: value })
                }
              >
                <SelectTrigger className="bg-transparent border-border-default">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {states.map((state) => (
                    <SelectItem key={state.id} value={state.id}>
                      {state.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Separator className="bg-border-default" />

        {/* Configuration */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Configuration</Label>

          <div className="space-y-2">
            <Label className="text-xs">Timeout (ms)</Label>
            <Input
              type="number"
              value={localTransition.timeout || 0}
              onChange={(e) =>
                setLocalTransition({
                  ...localTransition,
                  timeout: parseInt(e.target.value) || 0,
                })
              }
              className="bg-transparent border-border-default"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Retry Count</Label>
            <Input
              type="number"
              value={localTransition.retryCount || 0}
              onChange={(e) =>
                setLocalTransition({
                  ...localTransition,
                  retryCount: parseInt(e.target.value) || 0,
                })
              }
              className="bg-transparent border-border-default"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Workflows</Label>
            <div className="space-y-1">
              {localTransition.workflows.map((workflowId, index) => {
                const workflow = workflows.find((w) => w.id === workflowId);
                return (
                  <div
                    key={workflowId}
                    className="flex items-center justify-between p-2 bg-surface-raised rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className="text-xs">{index + 1}</Badge>
                      <span className="text-sm">
                        {workflow?.name || "Unknown"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-400"
                      onClick={() =>
                        setLocalTransition({
                          ...localTransition,
                          workflows: localTransition.workflows.filter(
                            (id) => id !== workflowId
                          ),
                        })
                      }
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
              <Select
                value=""
                onValueChange={(value) =>
                  setLocalTransition({
                    ...localTransition,
                    workflows: [...localTransition.workflows, value],
                  })
                }
              >
                <SelectTrigger className="bg-transparent border-border-default">
                  <SelectValue placeholder="Add workflow..." />
                </SelectTrigger>
                <SelectContent>
                  {workflows
                    .filter((w) => !localTransition.workflows.includes(w.id))
                    .map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>

      <CardContent className="flex-shrink-0 pt-0">
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            className="flex-1 bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
          <DestructiveButton
            onClick={() => onDelete(localTransition.id)}
            className="border-red-400 text-red-400 hover:bg-red-400/20"
          >
            <Trash2 className="w-4 h-4" />
          </DestructiveButton>
        </div>
      </CardContent>
    </Card>
  );
}
