"use client";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Compass } from "lucide-react";
import type { UIBridgeExplorationConfig } from "../exploration-config-types";

interface LimitsConfigSectionProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  isRunning: boolean;
}

export function LimitsConfigSection({
  config,
  onConfigChange,
  isRunning,
}: LimitsConfigSectionProps) {
  return (
    <Card className="p-4 bg-surface-raised/60 border-brand-secondary/30">
      <div className="flex items-center gap-2 mb-4">
        <Compass className="w-4 h-4 text-brand-secondary" />
        <Label className="text-brand-secondary font-mono text-sm uppercase tracking-wider">
          Exploration Limits
        </Label>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-text-muted text-xs">
            Max Navigation Depth
          </Label>
          <Input
            type="number"
            min={0}
            max={5}
            value={config.maxDepth}
            onChange={(e) =>
              onConfigChange({ maxDepth: parseInt(e.target.value) || 0 })
            }
            disabled={isRunning}
            className="bg-surface-canvas border-brand-secondary/20"
          />
          <p className="text-[10px] text-text-muted">
            0 = current page only, higher values explore linked pages
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-text-muted text-xs">Elements/Page</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={config.maxElementsPerPage}
              onChange={(e) =>
                onConfigChange({
                  maxElementsPerPage: parseInt(e.target.value) || 1,
                })
              }
              disabled={isRunning}
              className="bg-surface-canvas border-brand-secondary/20"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-text-muted text-xs">Total Elements</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={config.maxTotalElements}
              onChange={(e) =>
                onConfigChange({
                  maxTotalElements: parseInt(e.target.value) || 1,
                })
              }
              disabled={isRunning}
              className="bg-surface-canvas border-brand-secondary/20"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
