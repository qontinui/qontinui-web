import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { UpdateConfigFn } from "../types";

interface OutputVariableInputProps {
  value: string | undefined;
  updateConfig: UpdateConfigFn;
  placeholder?: string;
  helpText?: string;
}

export function OutputVariableInput({
  value,
  updateConfig,
  placeholder = "command_output",
  helpText = "Store command output in this workflow variable",
}: OutputVariableInputProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">Output Variable</Label>
      <Input
        type="text"
        value={value || ""}
        onChange={(e) =>
          updateConfig("outputVariable", e.target.value || undefined)
        }
        placeholder={placeholder}
        className="bg-transparent border-border-default"
      />
      <p className="text-xs text-text-muted">{helpText}</p>
    </div>
  );
}
