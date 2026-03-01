"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Assertion,
  AssertionType,
} from "@/services/workflow-testing-service";

interface AssertionEditorProps {
  assertion: Assertion;
  onUpdate: (updates: Partial<Assertion>) => void;
  onRemove: () => void;
}

const ASSERTION_TYPES: AssertionType[] = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "exists",
  "notExists",
  "greaterThan",
  "lessThan",
  "regex",
  "custom",
];

export function AssertionEditor({
  assertion,
  onUpdate,
  onRemove,
}: AssertionEditorProps) {
  const needsExpectedValue = [
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "greaterThan",
    "lessThan",
  ].includes(assertion.type);

  const needsPattern = assertion.type === "regex";
  const needsCustomFunction = assertion.type === "custom";

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 grid grid-cols-2 gap-3">
            {/* Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={assertion.type}
                onValueChange={(value) =>
                  onUpdate({ type: value as AssertionType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSERTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Path */}
            <div className="space-y-2">
              <Label>Path</Label>
              <Input
                value={assertion.path || ""}
                onChange={(e) => onUpdate({ path: e.target.value })}
                placeholder="e.g., variables.username"
              />
            </div>
          </div>

          {/* Remove button */}
          <Button onClick={onRemove} variant="ghost" size="icon">
            <Trash2 className="size-4" />
          </Button>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label>Description</Label>
          <Input
            value={assertion.description || ""}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Describe this assertion..."
          />
        </div>

        {/* Expected value */}
        {needsExpectedValue && (
          <div className="space-y-2">
            <Label>Expected Value</Label>
            <Input
              value={
                assertion.expected !== undefined && assertion.expected !== null
                  ? String(assertion.expected)
                  : ""
              }
              onChange={(e) => {
                // Try to parse as JSON for complex values
                try {
                  const parsed = JSON.parse(e.target.value);
                  onUpdate({ expected: parsed });
                } catch {
                  onUpdate({ expected: e.target.value });
                }
              }}
              placeholder="Expected value..."
            />
          </div>
        )}

        {/* Regex pattern */}
        {needsPattern && (
          <div className="space-y-2">
            <Label>Pattern</Label>
            <Input
              value={assertion.pattern || ""}
              onChange={(e) => onUpdate({ pattern: e.target.value })}
              placeholder="Regular expression pattern..."
            />
          </div>
        )}

        {/* Custom function */}
        {needsCustomFunction && (
          <div className="space-y-2">
            <Label>Custom Function</Label>
            <Textarea
              value={assertion.customFunction || ""}
              onChange={(e) => onUpdate({ customFunction: e.target.value })}
              placeholder="return value === expectedValue;"
              rows={4}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
