import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OUTPUT_FORMAT_OPTIONS,
  type OutputFormat,
  type UpdateConfigFn,
} from "../types";

interface OutputFormatSelectProps {
  value: OutputFormat | undefined;
  updateConfig: UpdateConfigFn;
}

export function OutputFormatSelect({
  value,
  updateConfig,
}: OutputFormatSelectProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-text-muted">Output Format</Label>
      <Select
        value={value || "text"}
        onValueChange={(v) => updateConfig("outputFormat", v)}
      >
        <SelectTrigger className="bg-transparent border-border-default">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-surface-raised border-border-default">
          {OUTPUT_FORMAT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div>
                <span>{opt.label}</span>
                <span className="text-text-muted ml-2 text-xs">
                  - {opt.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
