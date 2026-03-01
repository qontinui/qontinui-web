"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { KeyValueEditor } from "./KeyValueEditor";
import type { Workflow } from "@/lib/action-schema/action-types";

interface ExpectedOutputsCardProps {
  expanded: boolean;
  onToggle: () => void;
  shouldSucceed: boolean;
  onShouldSucceedChange: (value: boolean) => void;
  expectedFinalAction: string;
  onExpectedFinalActionChange: (value: string) => void;
  maxDuration: number;
  onMaxDurationChange: (value: number) => void;
  expectedVariables: Record<string, unknown>;
  onAddExpectedVariable: (key: string, value: unknown) => void;
  onRemoveExpectedVariable: (key: string) => void;
  workflow: Workflow;
}

export function ExpectedOutputsCard({
  expanded,
  onToggle,
  shouldSucceed,
  onShouldSucceedChange,
  expectedFinalAction,
  onExpectedFinalActionChange,
  maxDuration,
  onMaxDurationChange,
  expectedVariables,
  onAddExpectedVariable,
  onRemoveExpectedVariable,
  workflow,
}: ExpectedOutputsCardProps) {
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <CardTitle>Expected Outputs</CardTitle>
        </div>
        <CardDescription>Define expected behavior and outcomes</CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {/* Should Succeed */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="shouldSucceed"
              checked={shouldSucceed}
              onChange={(e) => onShouldSucceedChange(e.target.checked)}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="shouldSucceed">Workflow should succeed</Label>
          </div>

          {/* Expected Final Action */}
          <div className="space-y-2">
            <Label htmlFor="finalAction">Expected Final Action ID</Label>
            <Select
              value={expectedFinalAction}
              onValueChange={onExpectedFinalActionChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select action..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {workflow.actions.map((action) => (
                  <SelectItem key={action.id} value={action.id}>
                    {action.name || action.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Max Duration */}
          <div className="space-y-2">
            <Label htmlFor="maxDuration">Max Duration (ms)</Label>
            <Input
              id="maxDuration"
              type="number"
              value={maxDuration}
              onChange={(e) => onMaxDurationChange(Number(e.target.value))}
              min={0}
            />
          </div>

          <Separator />

          {/* Expected Variables */}
          <div className="space-y-2">
            <Label>Expected Variables</Label>
            <KeyValueEditor
              values={expectedVariables}
              onAdd={onAddExpectedVariable}
              onRemove={onRemoveExpectedVariable}
              placeholder="Add expected variable..."
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
