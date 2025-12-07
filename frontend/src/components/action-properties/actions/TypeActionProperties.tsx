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

/**
 * Properties component for TYPE action.
 */
export function TypeActionProperties({
  action,
  updateConfig,
  states,
  textAreaRef,
}: ActionPropertiesComponentProps) {
  // Initialize textSource to default value if not set
  useEffect(() => {
    if (!action.config.textSource) {
      updateConfig("textSource", "stateString");
    }
  }, []);

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Text Source</Label>
        <Select
          value={action.config.textSource || "stateString"}
          onValueChange={(value) => {
            updateConfig("textSource", value);
            // If switching to stateString and no state selected, try to select the first available state
            if (value === "stateString" && !action.config.selectedState) {
              const statesWithStrings = states.filter(
                (s) => s.strings && s.strings.length > 0
              );
              if (statesWithStrings.length > 0) {
                updateConfig("selectedState", statesWithStrings[0].id);
              }
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

      {action.config.textSource === "stateString" ||
      !action.config.textSource ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Select State</Label>
            <Select
              value={action.config.selectedState || "none"}
              onValueChange={(value) => {
                const stateValue = value === "none" ? null : value;
                // Update both selectedState and selectedStateStrings in one call
                updateConfig("selectedState", stateValue, {
                  selectedStateStrings: [],
                });
              }}
            >
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue placeholder="Select a state" />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                {states.filter((s) => s.strings && s.strings.length > 0)
                  .length === 0 ? (
                  <SelectItem value="none" disabled>
                    No states with strings defined
                  </SelectItem>
                ) : (
                  <>
                    <SelectItem value="none">Select a state...</SelectItem>
                    {states
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

          {action.config.selectedState &&
            (() => {
              const selectedState = states.find(
                (s) => s.id === action.config.selectedState
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
                    {selectedState.strings.map((str: any, index: number) => (
                      <div key={str.id} className="flex items-start space-x-2">
                        <Checkbox
                          id={`string-${str.id}`}
                          checked={
                            action.config.selectedStateStrings?.includes(
                              str.id
                            ) || false
                          }
                          onCheckedChange={(checked) => {
                            const current =
                              action.config.selectedStateStrings || [];
                            if (checked) {
                              updateConfig("selectedStateStrings", [
                                ...current,
                                str.id,
                              ]);
                            } else {
                              updateConfig(
                                "selectedStateStrings",
                                current.filter((id: string) => id !== str.id)
                              );
                            }
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
                    ))}
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
            value={action.config.text}
            onChange={(e) => updateConfig("text", e.target.value)}
            className="bg-transparent border-gray-700 font-mono text-sm"
            placeholder="Enter text to type..."
            rows={4}
          />
          {action.config.text && (
            <div className="p-2 bg-gray-800/50 rounded-md border border-gray-700">
              <div className="text-xs text-gray-500 mb-1">Preview:</div>
              <div className="text-sm font-mono text-gray-300 break-all">
                <SpecialKeyDisplay text={action.config.text} />
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
          value={action.config.typing_delay}
          onChange={(e) =>
            updateConfig("typing_delay", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="clear_before"
          checked={action.config.clear_before}
          onCheckedChange={(checked) => updateConfig("clear_before", checked)}
        />
        <Label htmlFor="clear_before" className="text-xs text-gray-400">
          Clear before typing
        </Label>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="press_enter"
          checked={action.config.press_enter}
          onCheckedChange={(checked) => {
            updateConfig("press_enter", checked);
            // If enabling press_enter and text doesn't end with {ENTER}, add it
            // If disabling press_enter and text ends with {ENTER}, remove it
            const currentText = action.config.text || "";
            if (checked && !currentText.endsWith("{ENTER}")) {
              updateConfig("text", currentText + "{ENTER}");
            } else if (!checked && currentText.endsWith("{ENTER}")) {
              updateConfig("text", currentText.slice(0, -7)); // Remove "{ENTER}" (7 chars)
            }
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
