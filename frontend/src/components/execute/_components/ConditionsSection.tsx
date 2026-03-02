"use client";

import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ConditionsSectionProps {
  showConditions: boolean;
  setShowConditions: (v: boolean) => void;
  requireIdle: boolean;
  setRequireIdle: (v: boolean) => void;
  timeoutMinutes: number | "";
  setTimeoutMinutes: (v: number | "") => void;
}

export function ConditionsSection({
  showConditions,
  setShowConditions,
  requireIdle,
  setRequireIdle,
  timeoutMinutes,
  setTimeoutMinutes,
}: ConditionsSectionProps) {
  return (
    <div className="space-y-2">
      <button
        onClick={() => setShowConditions(!showConditions)}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors"
      >
        {showConditions ? (
          <ChevronUp className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
        Show conditions
      </button>

      {showConditions && (
        <div className="space-y-3 border-l-2 border-border-subtle/30 ml-1 py-2 pl-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={requireIdle}
              onChange={(e) => setRequireIdle(e.target.checked)}
              className="rounded border-border-subtle"
            />
            <span className="text-sm text-text-secondary">
              Require idle (no other tasks running)
            </span>
          </label>

          <div className="space-y-1">
            <label htmlFor="sed-timeout" className="text-xs text-text-muted">
              Timeout (minutes)
            </label>
            <Input
              id="sed-timeout"
              type="number"
              min={0}
              placeholder="0 = no timeout"
              value={timeoutMinutes}
              onChange={(e) =>
                setTimeoutMinutes(
                  e.target.value === ""
                    ? ""
                    : Math.max(0, parseInt(e.target.value) || 0)
                )
              }
              className="w-32 bg-surface-canvas/50 border-border-subtle/50 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
