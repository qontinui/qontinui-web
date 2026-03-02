"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings } from "lucide-react";
import type {
  WorkflowSectionProps,
  UpdateSettingsFn,
} from "./WorkflowPropertiesTypes";

interface SettingsSectionProps extends WorkflowSectionProps {
  onUpdate: UpdateSettingsFn;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  workflow,
  onUpdate,
}) => {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-green-400" />
        <h3 className="text-sm font-semibold text-text-secondary">
          Workflow Settings
        </h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Timeout (ms)</Label>
          <Input
            type="number"
            value={workflow.settings?.timeout || 0}
            onChange={(e) => onUpdate("timeout", Number(e.target.value))}
            className="bg-transparent border-border-default text-text-secondary"
            placeholder="0 (no timeout)"
          />
          <p className="text-xs text-text-muted">
            Maximum time for entire workflow execution
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Max Retries</Label>
          <Input
            type="number"
            value={workflow.settings?.maxRetries || 0}
            onChange={(e) => onUpdate("maxRetries", Number(e.target.value))}
            className="bg-transparent border-border-default text-text-secondary"
            min="0"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Retry Delay (ms)</Label>
          <Input
            type="number"
            value={workflow.settings?.retryDelay || 1000}
            onChange={(e) => onUpdate("retryDelay", Number(e.target.value))}
            className="bg-transparent border-border-default text-text-secondary"
            min="0"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Log Level</Label>
          <Select
            value={workflow.settings?.logLevel || "info"}
            onValueChange={(value) => onUpdate("logLevel", value)}
          >
            <SelectTrigger className="bg-transparent border-border-default text-text-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface-raised border-border-default">
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs text-text-muted">
              Parallel Execution
            </Label>
            <p className="text-xs text-text-muted">Enable parallel branches</p>
          </div>
          <Switch
            checked={workflow.settings?.enableParallelExecution || false}
            onCheckedChange={(checked) =>
              onUpdate("enableParallelExecution", checked)
            }
          />
        </div>
      </div>
    </section>
  );
};
