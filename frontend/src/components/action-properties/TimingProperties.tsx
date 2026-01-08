"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { Action } from "./types";

interface TimingPropertiesProps {
  action: Action;
  updateConfig?: (key: string, value: unknown) => void;
}

/**
 * Reusable timing properties component for pauseBeforeBegin and pauseAfterEnd.
 * These settings are stored in action.base (not action.config) and exported as camelCase.
 */
export function TimingProperties({
  action,
  updateConfig,
}: TimingPropertiesProps) {
  const pauseBeforeBegin = action.base?.pauseBeforeBegin;
  const pauseAfterEnd = action.base?.pauseAfterEnd;

  const updateBase = (
    key: "pauseBeforeBegin" | "pauseAfterEnd",
    value: number | undefined
  ) => {
    if (!updateConfig) return;

    const newBase = { ...(action.base || {}), [key]: value };
    // Remove undefined values
    if (value === undefined) {
      delete newBase[key];
    }
    // Update via special __base__ key that the action editor will handle
    updateConfig(
      "__base__",
      Object.keys(newBase).length > 0 ? newBase : undefined
    );
  };

  return (
    <>
      {/* Pause Before Begin Override */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            Pause Before Begin Override (ms)
          </Label>
          {pauseBeforeBegin !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
              onClick={() => updateBase("pauseBeforeBegin", undefined)}
              title="Remove override (use default 0ms)"
            >
              <X className="w-3 h-3" />
            </Button>
          ) : (
            <span className="text-xs text-text-muted">(default: 0ms)</span>
          )}
        </div>
        {pauseBeforeBegin !== undefined ? (
          <Input
            type="number"
            min="0"
            value={pauseBeforeBegin}
            onChange={(e) =>
              updateBase("pauseBeforeBegin", Number.parseInt(e.target.value))
            }
            className="bg-transparent border-border-default"
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
            onClick={() => updateBase("pauseBeforeBegin", 0)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Set Override
          </Button>
        )}
      </div>

      {/* Pause After End Override */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            Pause After End Override (ms)
          </Label>
          {pauseAfterEnd !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
              onClick={() => updateBase("pauseAfterEnd", undefined)}
              title="Remove override (use default 0ms)"
            >
              <X className="w-3 h-3" />
            </Button>
          ) : (
            <span className="text-xs text-text-muted">(default: 0ms)</span>
          )}
        </div>
        {pauseAfterEnd !== undefined ? (
          <Input
            type="number"
            min="0"
            value={pauseAfterEnd}
            onChange={(e) =>
              updateBase("pauseAfterEnd", Number.parseInt(e.target.value))
            }
            className="bg-transparent border-border-default"
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
            onClick={() => updateBase("pauseAfterEnd", 0)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Set Override
          </Button>
        )}
      </div>
    </>
  );
}
