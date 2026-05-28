/**
 * Multi-Select Properties Component
 *
 * Shows common properties for multiple selected nodes and allows batch editing.
 * - Shows properties common to all selected nodes
 * - Displays "(mixed)" for properties with different values
 * - Batch updates all selected nodes
 * - Individual override for specific properties
 */

"use client";

import React from "react";
import { useMultiPropertyAdapter } from "./property-adapter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Users, AlertCircle, Save, RotateCcw } from "lucide-react";
import { createLogger } from "@/lib/logger";

const log = createLogger("MultiSelectProperties");

export interface MultiSelectPropertiesProps {
  actionIds: string[];
  className?: string;
}

export const MultiSelectProperties: React.FC<MultiSelectPropertiesProps> = ({
  actionIds,
  className = "",
}) => {
  const {
    actions,
    updateCommonConfig,
    getCommonValue,
    isMixedValue,
    saveAllChanges,
    discardAllChanges,
  } = useMultiPropertyAdapter(actionIds);

  if (actions.length === 0) {
    return (
      <div className={`p-4 text-text-muted text-sm ${className}`}>
        No actions selected
      </div>
    );
  }

  // Get common properties
  const commonEnabled = getCommonValue("enabled");
  const commonTimeout = getCommonValue("timeout");
  const commonRetries = getCommonValue("maxRetries");

  // Check for type consistency
  const actionTypes = new Set(actions.map((a) => a.type));
  const multipleTypes = actionTypes.size > 1;

  return (
    <div className={`overflow-y-auto ${className}`}>
      <div className="p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-text-secondary">
              Multiple Selection ({actions.length} actions)
            </h3>
          </div>
          <div className="flex gap-2">
            <DestructiveButton
              size="sm"
              onClick={discardAllChanges}
              className="h-7 text-xs"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </DestructiveButton>
            <Button
              size="sm"
              onClick={saveAllChanges}
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
            >
              <Save className="w-3 h-3 mr-1" />
              Save All
            </Button>
          </div>
        </div>

        {/* Type Info */}
        {multipleTypes && (
          <div className="p-3 rounded bg-yellow-900/20 border border-yellow-700/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-text-secondary">
                <strong>Mixed action types selected:</strong>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Array.from(actionTypes).map((type) => (
                    <Badge
                      key={type}
                      variant="secondary"
                      className="text-xs bg-surface-raised text-text-secondary"
                    >
                      {type}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <Separator className="bg-border-default" />

        {/* Common Base Settings */}
        <section>
          <h4 className="text-xs font-semibold text-text-muted mb-3">
            Base Settings
          </h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs text-text-muted">Enabled</Label>
                <p className="text-xs text-text-muted">
                  Enable/disable all selected actions
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isMixedValue("enabled") && (
                  <span className="text-xs text-yellow-400">(mixed)</span>
                )}
                <Switch
                  checked={commonEnabled !== false}
                  onCheckedChange={(checked) =>
                    updateCommonConfig("enabled", checked)
                  }
                />
              </div>
            </div>
          </div>
        </section>

        <Separator className="bg-border-default" />

        {/* Execution Settings */}
        <section>
          <h4 className="text-xs font-semibold text-text-muted mb-3">
            Execution Settings
          </h4>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-text-muted">Timeout (ms)</Label>
                {isMixedValue("timeout") && (
                  <span className="text-xs text-yellow-400">(mixed)</span>
                )}
              </div>
              <Input
                type="number"
                value={typeof commonTimeout === "number" ? commonTimeout : ""}
                onChange={(e) =>
                  updateCommonConfig("timeout", Number(e.target.value))
                }
                placeholder={isMixedValue("timeout") ? "Mixed values" : "0"}
                className="bg-transparent border-border-default text-text-secondary"
                min="0"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-text-muted">Max Retries</Label>
                {isMixedValue("maxRetries") && (
                  <span className="text-xs text-yellow-400">(mixed)</span>
                )}
              </div>
              <Input
                type="number"
                value={typeof commonRetries === "number" ? commonRetries : ""}
                onChange={(e) =>
                  updateCommonConfig("maxRetries", Number(e.target.value))
                }
                placeholder={isMixedValue("maxRetries") ? "Mixed values" : "0"}
                className="bg-transparent border-border-default text-text-secondary"
                min="0"
              />
            </div>
          </div>
        </section>

        <Separator className="bg-border-default" />

        {/* Position Settings */}
        <section>
          <h4 className="text-xs font-semibold text-text-muted mb-3">
            Position
          </h4>
          <div className="space-y-3">
            <p className="text-xs text-text-muted">
              Position properties cannot be batch edited. Use canvas drag or
              alignment tools.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => log.debug("Align left")}
              >
                Align Left
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => log.debug("Align center")}
              >
                Align Center
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => log.debug("Align right")}
              >
                Align Right
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => log.debug("Align top")}
              >
                Align Top
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => log.debug("Align middle")}
              >
                Align Middle
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => log.debug("Align bottom")}
              >
                Align Bottom
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="col-span-3 h-8 text-xs"
                onClick={() => log.debug("Distribute")}
              >
                Distribute Evenly
              </Button>
            </div>
          </div>
        </section>

        <Separator className="bg-border-default" />

        {/* Action List */}
        <section>
          <h4 className="text-xs font-semibold text-text-muted mb-3">
            Selected Actions
          </h4>
          <div className="space-y-1">
            {actions.map((action, index) => (
              <div
                key={action.id}
                className="flex items-center justify-between p-2 rounded bg-surface-raised/50 border border-border-default"
              >
                <div className="flex-1">
                  <div className="text-xs font-medium text-text-secondary">
                    {action.type}
                  </div>
                  <div className="text-xs text-text-muted">{action.id}</div>
                </div>
                <Badge
                  variant="secondary"
                  className="text-xs bg-surface-raised text-text-secondary"
                >
                  #{index + 1}
                </Badge>
              </div>
            ))}
          </div>
        </section>

        {/* Info */}
        <div className="p-3 rounded bg-blue-900/20 border border-blue-700/30">
          <div className="text-xs text-text-secondary">
            <strong>Batch Editing:</strong> Changes apply to all selected
            actions. Properties with different values show &quot;(mixed)&quot;.
            Edit to override with common value.
          </div>
        </div>
      </div>
    </div>
  );
};
