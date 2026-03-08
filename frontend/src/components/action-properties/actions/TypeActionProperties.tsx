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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount to set default value
  }, []);

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Text Source</Label>
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
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            <SelectItem value="stateString">State String</SelectItem>
            <SelectItem value="manual">Manual Text</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {config.textSource ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Select State</Label>
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
              <SelectTrigger className="bg-transparent border-border-default">
                <SelectValue placeholder="Select a state" />
              </SelectTrigger>
              <SelectContent className="bg-surface-raised border-border-default">
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
                  <div className="text-xs text-text-muted p-2 bg-surface-raised/50 rounded">
                    No strings defined in this state
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <Label className="text-xs text-text-muted">
                    Select Strings
                  </Label>
                  <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-surface-raised/50 rounded border border-border-default">
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
                              className="text-xs text-text-muted"
                            >
                              {index + 1}. {str.name || "Unnamed"}
                            </Label>
                            <div className="text-xs text-text-muted font-mono mt-1 break-all">
                              &quot;
                              <SpecialKeyDisplay text={str.value} />
                              &quot;
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
            <Label className="text-xs text-text-muted">Text to Type</Label>
            <SpecialKeysSelector
              onInsertKey={(newText) => updateConfig("text", newText)}
              textAreaRef={textAreaRef}
            />
          </div>
          <Textarea
            ref={textAreaRef}
            value={config.text || ""}
            onChange={(e) => updateConfig("text", e.target.value)}
            className="bg-transparent border-border-default font-mono text-sm"
            placeholder="Enter text to type..."
            rows={4}
          />
          {config.text && (
            <div className="p-2 bg-surface-raised/50 rounded-md border border-border-default">
              <div className="text-xs text-text-muted mb-1">Preview:</div>
              <div className="text-sm font-mono text-text-default break-all">
                <SpecialKeyDisplay text={config.text} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Typing Delay (ms)</Label>
        <Input
          type="number"
          min="0"
          value={config.typeDelay || 0}
          onChange={(e) =>
            updateConfig("typeDelay", Number.parseInt(e.target.value))
          }
          className="bg-transparent border-border-default"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="clear_before"
          checked={config.clearBefore || false}
          onCheckedChange={(checked) => updateConfig("clearBefore", checked)}
        />
        <Label htmlFor="clear_before" className="text-xs text-text-muted">
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
        <Label htmlFor="press_enter" className="text-xs text-text-muted">
          Press Enter after typing
        </Label>
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
