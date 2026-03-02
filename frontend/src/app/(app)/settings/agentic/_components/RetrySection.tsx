"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import type { RetrySettings } from "../types";

interface RetrySectionProps {
  value: RetrySettings;
  onChange: (value: RetrySettings) => void;
}

export function RetrySection({ value, onChange }: RetrySectionProps) {
  const [open, setOpen] = useState(false);

  const update = (patch: Partial<RetrySettings>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="rounded-lg border border-border">
      <div
        className="px-4 py-3 border-b border-border bg-muted/50 cursor-pointer select-none"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <RefreshCw className="size-4" />
            Retry with Feedback
          </h3>
          <Switch
            checked={value.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      {open && (
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Max Retries</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={value.max_retries}
              onChange={(e) => update({ max_retries: Number(e.target.value) })}
              disabled={!value.enabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Base Delay (ms)</Label>
            <Input
              type="number"
              min={100}
              max={10000}
              step={100}
              value={value.base_delay_ms}
              onChange={(e) =>
                update({ base_delay_ms: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Max Delay (ms)</Label>
            <Input
              type="number"
              min={1000}
              max={120000}
              step={1000}
              value={value.max_delay_ms}
              onChange={(e) => update({ max_delay_ms: Number(e.target.value) })}
              disabled={!value.enabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Exponential Base</Label>
            <Input
              type="number"
              min={1.1}
              max={4}
              step={0.1}
              value={value.exponential_base}
              onChange={(e) =>
                update({ exponential_base: Number(e.target.value) })
              }
              disabled={!value.enabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Add Jitter</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add random jitter to retry delays
              </p>
            </div>
            <Switch
              checked={value.jitter}
              onCheckedChange={(checked) => update({ jitter: checked })}
              disabled={!value.enabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Feedback Injection</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Include error context in retry prompts
              </p>
            </div>
            <Switch
              checked={value.feedback_injection}
              onCheckedChange={(checked) =>
                update({ feedback_injection: checked })
              }
              disabled={!value.enabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
