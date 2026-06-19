"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { BackoffConfig } from "../types";

interface BackoffFieldsProps {
  value: BackoffConfig;
  onChange: (value: BackoffConfig) => void;
}

/**
 * Numeric inputs for an exponential-backoff schedule. ``max_delay_secs`` is
 * nullable — toggling "Unbounded" off lets the operator set a cap.
 *
 * Copied from the deleted #580 settings UI
 * (`settings/auto-response/_components/BackoffFields.tsx`), re-scoped to the
 * tenant-admin Automation Rules page (local `../types`).
 */
export function BackoffFields({ value, onChange }: BackoffFieldsProps) {
  const update = (patch: Partial<BackoffConfig>) =>
    onChange({ ...value, ...patch });

  const unbounded = value.max_delay_secs === null;

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <h4 className="text-sm font-medium">Backoff</h4>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="backoff-initial">Initial Delay (secs)</Label>
          <Input
            id="backoff-initial"
            type="number"
            min={0}
            step={1}
            value={value.initial_delay_secs}
            onChange={(e) =>
              update({ initial_delay_secs: Number(e.target.value) })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="backoff-multiplier">Multiplier</Label>
          <Input
            id="backoff-multiplier"
            type="number"
            min={1}
            step={0.1}
            value={value.multiplier}
            onChange={(e) => update({ multiplier: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="backoff-max">Max Delay (secs)</Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Unbounded</span>
            <Switch
              checked={unbounded}
              onCheckedChange={(checked) =>
                update({ max_delay_secs: checked ? null : 300 })
              }
            />
          </div>
        </div>
        {unbounded ? (
          <p className="text-xs text-muted-foreground">
            No cap on the delay between retries.
          </p>
        ) : (
          <Input
            id="backoff-max"
            type="number"
            min={0}
            step={1}
            value={value.max_delay_secs ?? 0}
            onChange={(e) => update({ max_delay_secs: Number(e.target.value) })}
          />
        )}
      </div>
    </div>
  );
}
