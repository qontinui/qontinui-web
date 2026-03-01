"use client";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Clock } from "lucide-react";
import type { UIBridgeExplorationConfig } from "../exploration-config-types";

interface TimingConfigSectionProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  isRunning: boolean;
}

export function TimingConfigSection({
  config,
  onConfigChange,
  isRunning,
}: TimingConfigSectionProps) {
  return (
    <Card className="p-4 bg-surface-raised/60 border-brand-success/30">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-brand-success" />
        <Label className="text-brand-success font-mono text-sm uppercase tracking-wider">
          Timing & Behavior
        </Label>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-text-muted text-xs">Action Delay (ms)</Label>
          <Input
            type="number"
            min={100}
            max={5000}
            step={100}
            value={config.actionDelayMs}
            onChange={(e) =>
              onConfigChange({
                actionDelayMs: parseInt(e.target.value) || 500,
              })
            }
            disabled={isRunning}
            className="bg-surface-canvas border-brand-success/20"
          />
          <p className="text-[10px] text-text-muted">
            Wait time between actions (longer = safer)
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-2 bg-surface-canvas/50 rounded">
            <Label className="text-text-secondary text-xs">
              Capture Render Logs
            </Label>
            <Switch
              checked={config.captureRenderLogs}
              onCheckedChange={(checked) =>
                onConfigChange({ captureRenderLogs: checked })
              }
              disabled={isRunning}
            />
          </div>
          <div className="flex items-center justify-between p-2 bg-surface-canvas/50 rounded">
            <Label className="text-text-secondary text-xs">
              Track Visited States
            </Label>
            <Switch
              checked={config.trackVisitedStates}
              onCheckedChange={(checked) =>
                onConfigChange({ trackVisitedStates: checked })
              }
              disabled={isRunning}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
