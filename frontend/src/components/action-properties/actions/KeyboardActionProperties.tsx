"use client";

import { Label } from "@/components/ui/label";
import {
  SpecialKeysSelector,
  SpecialKeyDisplay,
} from "@/components/special-keys-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";

/**
 * Properties component for KEY_PRESS, KEY_DOWN, and KEY_UP actions.
 */
export function KeyboardActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const key = (action.config as Record<string, unknown>).key as
    | string
    | undefined;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">Key</Label>
          <SpecialKeysSelector
            onInsertKey={(key) => updateConfig("key", key)}
          />
        </div>
        {key && (
          <div className="p-2 bg-surface-raised/50 rounded-md border border-border-default">
            <div className="text-xs text-text-muted mb-1">Selected key:</div>
            <div className="text-sm font-mono text-text-default">
              <SpecialKeyDisplay text={key} />
            </div>
          </div>
        )}
        {!key && (
          <p className="text-xs text-text-muted">
            Select a key from the dropdown above
          </p>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
