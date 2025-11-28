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
  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Key</Label>
          <SpecialKeysSelector
            onInsertKey={(key) => updateConfig("key", key)}
            textAreaRef={null}
          />
        </div>
        {action.config.key && (
          <div className="p-2 bg-gray-800/50 rounded-md border border-gray-700">
            <div className="text-xs text-gray-500 mb-1">Selected key:</div>
            <div className="text-sm font-mono text-gray-300">
              <SpecialKeyDisplay text={action.config.key} />
            </div>
          </div>
        )}
        {!action.config.key && (
          <p className="text-xs text-gray-500">
            Select a key from the dropdown above
          </p>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
