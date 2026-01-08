"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { Action } from "./types";

interface DurationOverrideProps {
  action: Action;
  updateConfig: (key: string, value: unknown) => void;
}

/**
 * Reusable duration/timeout override component for FIND actions.
 * Controls how long the action will search before giving up.
 */
export function DurationOverride({
  action,
  updateConfig,
}: DurationOverrideProps) {
  const timeout = (action.config as Record<string, unknown>).timeout as
    | number
    | null
    | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-text-muted">
          Find Duration Override (ms)
        </Label>
        {timeout !== undefined && timeout !== null ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
            onClick={() => {
              const { timeout: _timeout, ...rest } = action.config as Record<
                string,
                unknown
              >;
              updateConfig("__reset__", rest);
            }}
            title="Remove override (use project default)"
          >
            <X className="w-3 h-3" />
          </Button>
        ) : (
          <span className="text-xs text-text-muted">
            (using project default)
          </span>
        )}
      </div>
      {timeout !== undefined && timeout !== null && (
        <div className="space-y-2">
          <Input
            type="number"
            min="0"
            step="100"
            value={timeout as number}
            onChange={(e) =>
              updateConfig("timeout", Number.parseInt(e.target.value) || 0)
            }
            className="bg-transparent border-border-default"
            placeholder="Duration in milliseconds"
          />
          <div className="text-xs text-text-muted">
            How long to search for the image before timing out
          </div>
        </div>
      )}
      {(timeout === undefined || timeout === null) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
          onClick={() => updateConfig("timeout", 3000)}
        >
          <Plus className="w-3 h-3 mr-1" />
          Set Override
        </Button>
      )}
    </div>
  );
}
