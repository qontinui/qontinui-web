import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SHELL_OPTIONS, type ShellType, type UpdateConfigFn } from "../types";

interface ShellTypeSelectProps {
  value: ShellType | undefined;
  updateConfig: UpdateConfigFn;
}

export function ShellTypeSelect({ value, updateConfig }: ShellTypeSelectProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">Shell</Label>
      <Select
        value={value || "bash"}
        onValueChange={(v) => updateConfig("shell", v)}
      >
        <SelectTrigger className="bg-transparent border-border-default">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-surface-raised border-border-default">
          {SHELL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
