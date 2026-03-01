"use client";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";
import type { UIBridgeExplorationConfig } from "../exploration-config-types";
import { parseCommaSeparated } from "../exploration-config-utils";

interface SafetyConfigSectionProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  isRunning: boolean;
}

export function SafetyConfigSection({
  config,
  onConfigChange,
  isRunning,
}: SafetyConfigSectionProps) {
  return (
    <Card className="p-4 bg-surface-raised/60 border-red-500/30 md:col-span-2">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="w-4 h-4 text-red-400" />
        <Label className="text-red-400 font-mono text-sm uppercase tracking-wider">
          Safety Filters
        </Label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-text-muted text-xs">
            Blocked Keywords (comma-separated)
          </Label>
          <Input
            value={config.blockedKeywords.join(", ")}
            onChange={(e) =>
              onConfigChange({
                blockedKeywords: parseCommaSeparated(e.target.value),
              })
            }
            disabled={isRunning}
            placeholder="delete, logout, remove..."
            className="bg-surface-canvas border-red-500/20"
          />
          <p className="text-[10px] text-text-muted">
            Skip elements containing these words
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-text-muted text-xs">
            Safe Keywords (comma-separated)
          </Label>
          <Input
            value={config.safeKeywords.join(", ")}
            onChange={(e) =>
              onConfigChange({
                safeKeywords: parseCommaSeparated(e.target.value),
              })
            }
            disabled={isRunning}
            placeholder="delete item from cart..."
            className="bg-surface-canvas border-brand-success/20"
          />
          <p className="text-[10px] text-text-muted">
            Allow elements even if they contain blocked words
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-text-muted text-xs">
            Blocked Selectors (comma-separated)
          </Label>
          <Input
            value={config.blockedSelectors.join(", ")}
            onChange={(e) =>
              onConfigChange({
                blockedSelectors: parseCommaSeparated(e.target.value),
              })
            }
            disabled={isRunning}
            placeholder="[data-no-explore], .dangerous-button..."
            className="bg-surface-canvas border-red-500/20"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-text-muted text-xs">
            Allowed Element Types (comma-separated)
          </Label>
          <Input
            value={config.allowedTypes.join(", ")}
            onChange={(e) =>
              onConfigChange({
                allowedTypes: parseCommaSeparated(e.target.value),
              })
            }
            disabled={isRunning}
            placeholder="button, link, tab, menuitem..."
            className="bg-surface-canvas border-brand-primary/20"
          />
        </div>
      </div>
    </Card>
  );
}
