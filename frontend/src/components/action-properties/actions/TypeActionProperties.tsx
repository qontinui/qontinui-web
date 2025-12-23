"use client";

import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SpecialKeysSelector,
  SpecialKeyDisplay,
} from "@/components/special-keys-selector";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import type { State, StateString } from "@/contexts/automation-context/types";
import type { Action } from "@/lib/action-schema/action-types";

/**
 * Properties component for TYPE action.
 */
export function TypeActionProperties({
  action,
  updateConfig,
  states,
  textAreaRef,
}: ActionPropertiesComponentProps) {
  // Type assertion for TYPE action - assuming component is only used for TYPE actions
  const typeAction = action as unknown as Action<"TYPE">;
  const config = typeAction.config;

  // Initialize textSource to default value if not set
  useEffect(() => {
    if (!config.textSource && !config.text) {
      // Default to manual text mode
      updateConfig("text", "");
    }
  }, []);

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Text Source</Label>
        <Select
          value={config.textSource ? "stateString" : "manual"}
          onValueChange={(value) => {
            if (value === "stateString") {
              // Switch to state string mode
              const statesWithStrings = (states as State[]).filter(
                (s) => s.strings && s.strings.length > 0
              );
              if (statesWithStrings.length > 0 && statesWithStrings[0]) {
                // Use additionalUpdates to batch both changes in a single call
                // This avoids stale closure issues with multiple updateConfig calls
                updateConfig(
                  "textSource",
                  {
                    stateId: statesWithStrings[0].id,
                    stringIds: [],
                    useAll: false,
                  },
                  { text: undefined }
                );
              }
            } else {
              // Switch to manual text mode
              // Use additionalUpdates to batch both changes in a single call
              // This avoids stale closure issues with multiple updateConfig calls
              updateConfig("textSource", undefined, { text: "" });
            }
          }}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="stateString">State String</SelectItem>
            <SelectItem value="manual">Manual Text</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {config.textSource ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Select State</Label>
            <Select
              value={config.textSource.stateId || "none"}
              onValueChange={(value) => {
                if (value === "none") {
                  updateConfig("textSource", undefined);
                } else {
                  updateConfig("textSource", {
                    stateId: value,
                    stringIds: [],
                    useAll: false,
                  });
                }
              }}
            >
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue placeholder="Select a state" />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                {(states as State[]).filter(
                  (s) => s.strings && s.strings.length > 0
                ).length === 0 ? (
                  <SelectItem value="none" disabled>
                    No states with strings defined
                  </SelectItem>
                ) : (
                  <>
                    <SelectItem value="none">Select a state...</SelectItem>
                    {(states as State[])
                      .filter((s) => s.strings && s.strings.length > 0)
                      .map((state) => (
                        <SelectItem key={state.id} value={state.id}>
                          {state.name || state.id} ({state.strings.length}{" "}
                          string{state.strings.length !== 1 ? "s" : ""})
                        </SelectItem>
                      ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {config.textSource &&
            (() => {
              const selectedState = (states as State[]).find(
                (s) => s.id === config.textSource!.stateId
              );
              if (
                !selectedState ||
                !selectedState.strings ||
                selectedState.strings.length === 0
              ) {
                return (
                  <div className="text-xs text-gray-500 p-2 bg-gray-800/50 rounded">
                    No strings defined in this state
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">
                    Select Strings
                  </Label>
                  <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-gray-800/50 rounded border border-gray-700">
                    {selectedState.strings.map(
                      (str: StateString, index: number) => (
                        <div
                          key={str.id}
                          className="flex items-start space-x-2"
                        >
                          <Checkbox
                            id={`string-${str.id}`}
                            checked={
                              config.textSource?.stringIds?.includes(str.id) ||
                              false
                            }
                            onCheckedChange={(checked) => {
                              const currentSource = config.textSource;
                              if (!currentSource) return;

                              const currentIds = currentSource.stringIds || [];
                              const newIds = checked
                                ? [...currentIds, str.id]
                                : currentIds.filter((id) => id !== str.id);

                              updateConfig("textSource", {
                                ...currentSource,
                                stringIds: newIds,
                              });
                            }}
                          />
                          <div className="flex-1">
                            <Label
                              htmlFor={`string-${str.id}`}
                              className="text-xs text-gray-400"
                            >
                              {index + 1}. {str.name || "Unnamed"}
                            </Label>
                            <div className="text-xs text-gray-500 font-mono mt-1 break-all">
                              "<SpecialKeyDisplay text={str.value} />"
                            </div>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })()}
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">Text to Type</Label>
            <SpecialKeysSelector
              onInsertKey={(newText) => updateConfig("text", newText)}
              textAreaRef={textAreaRef}
            />
          </div>
          <Textarea
            ref={textAreaRef}
            value={config.text || ""}
            onChange={(e) => updateConfig("text", e.target.value)}
            className="bg-transparent border-gray-700 font-mono text-sm"
            placeholder="Enter text to type..."
            rows={4}
          />
          {config.text && (
            <div className="p-2 bg-gray-800/50 rounded-md border border-gray-700">
              <div className="text-xs text-gray-500 mb-1">Preview:</div>
              <div className="text-sm font-mono text-gray-300 break-all">
                <SpecialKeyDisplay text={config.text} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Typing Delay (ms)</Label>
        <Input
          type="number"
          min="0"
          value={config.typeDelay || 0}
          onChange={(e) =>
            updateConfig("typeDelay", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="clear_before"
          checked={config.clearBefore || false}
          onCheckedChange={(checked) => updateConfig("clearBefore", checked)}
        />
        <Label htmlFor="clear_before" className="text-xs text-gray-400">
          Clear before typing
        </Label>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="press_enter"
          checked={config.pressEnter || false}
          onCheckedChange={(checked) => {
            updateConfig("pressEnter", checked);
          }}
        />
        <Label htmlFor="press_enter" className="text-xs text-gray-400">
          Press Enter after typing
        </Label>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
