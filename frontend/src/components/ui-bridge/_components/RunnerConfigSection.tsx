"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Compass, Loader2 } from "lucide-react";
import type { Runner, TargetType } from "../exploration-config-types";

interface RunnerConfigSectionProps {
  targetType: TargetType;
  runners: Runner[];
  runnersLoading: boolean;
  selectedRunnerId: string | null;
  onRunnerChange: (runnerId: string | null) => void;
  isRunning: boolean;
}

export function RunnerConfigSection({
  targetType,
  runners,
  runnersLoading,
  selectedRunnerId,
  onRunnerChange,
  isRunning,
}: RunnerConfigSectionProps) {
  return (
    <Card className="p-4 bg-surface-raised/60 border-brand-primary/30">
      <div className="flex items-center gap-2 mb-4">
        <Compass className="w-4 h-4 text-brand-primary" />
        <Label className="text-brand-primary font-mono text-sm uppercase tracking-wider">
          Runner
        </Label>
      </div>

      <div className="space-y-4">
        {targetType === "extension" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 bg-surface-canvas/50 rounded border border-brand-primary/20">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-text-primary">
                Local Runner (localhost:9876)
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Browser Extension mode connects directly to the local runner. Make
              sure the runner is running and the extension shows &quot;Runner
              connected&quot;.
            </p>
          </div>
        ) : runnersLoading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading runners...</span>
          </div>
        ) : runners.length === 0 ? (
          <Alert
            variant="destructive"
            className="border-red-500/30 bg-red-500/10"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              No runners online. Connect a runner from the Runners page first,
              or use Browser Extension mode for local exploration.
            </AlertDescription>
          </Alert>
        ) : (
          <Select
            value={selectedRunnerId ?? ""}
            onValueChange={(value) => onRunnerChange(value || null)}
            disabled={isRunning}
          >
            <SelectTrigger className="bg-surface-canvas border-brand-primary/20">
              <SelectValue placeholder="Select a runner" />
            </SelectTrigger>
            <SelectContent>
              {runners.map((runner) => (
                <SelectItem key={runner.id} value={runner.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span>{runner.name}</span>
                    {runner.hostname && (
                      <span className="text-text-muted text-xs">
                        ({runner.hostname})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </Card>
  );
}
