"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { KeyValueEditor } from "./KeyValueEditor";
import { ArrayEditor } from "./ArrayEditor";

interface InputConfigCardProps {
  expanded: boolean;
  onToggle: () => void;
  inputVariables: Record<string, unknown>;
  onAddInputVariable: (key: string, value: unknown) => void;
  onRemoveInputVariable: (key: string) => void;
  initialScreenshots: string[];
  onScreenshotsChange: (values: string[]) => void;
  initialStates: string[];
  onStatesChange: (values: string[]) => void;
}

export function InputConfigCard({
  expanded,
  onToggle,
  inputVariables,
  onAddInputVariable,
  onRemoveInputVariable,
  initialScreenshots,
  onScreenshotsChange,
  initialStates,
  onStatesChange,
}: InputConfigCardProps) {
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <CardTitle>Input Configuration</CardTitle>
        </div>
        <CardDescription>
          Define initial state and input variables for the test
        </CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {/* Input Variables */}
          <div className="space-y-2">
            <Label>Input Variables</Label>
            <KeyValueEditor
              values={inputVariables}
              onAdd={onAddInputVariable}
              onRemove={onRemoveInputVariable}
              placeholder="Add input variable..."
            />
          </div>

          <Separator />

          {/* Initial Screenshots */}
          <div className="space-y-2">
            <Label>Initial Screenshots (IDs)</Label>
            <ArrayEditor
              values={initialScreenshots}
              onChange={onScreenshotsChange}
              placeholder="Screenshot ID..."
            />
          </div>

          {/* Initial States */}
          <div className="space-y-2">
            <Label>Initial Active States (IDs)</Label>
            <ArrayEditor
              values={initialStates}
              onChange={onStatesChange}
              placeholder="State ID..."
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
