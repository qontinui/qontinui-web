"use client";

import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, AlertTriangle, Info } from "lucide-react";
import {
  SpecialKeysSelector,
  SpecialKeyDisplay,
} from "@/components/special-keys-selector";
import { MonitorSelector } from "@/components/monitor-selector";
import { TabsContent } from "@/components/ui/tabs";
import type { State, StateString } from "@/stores/automation";

interface StringsTabProps {
  state: State;
  addString: () => void;
  updateString: (
    index: number,
    field: keyof StateString,
    value: string | boolean | number[]
  ) => void;
  removeString: (index: number) => void;
}

export function StringsTab({
  state,
  addString,
  updateString,
  removeString,
}: StringsTabProps) {
  const stringTextAreaRefs = useRef<{
    [key: string]: HTMLTextAreaElement | null;
  }>({});

  // Function to set a ref for a specific string's textarea
  const setStringTextAreaRef =
    (stringId: string) => (el: HTMLTextAreaElement | null) => {
      stringTextAreaRefs.current[stringId] = el;
    };

  return (
    <TabsContent
      value="strings"
      className="flex-1 flex flex-col min-h-0 p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs text-text-muted">State Strings</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={addString}
          className="text-text-muted hover:text-text-secondary"
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      {state.strings?.length === 0 ? (
        <div className="flex-1 flex items-center justify-center border border-dashed border-border-subtle rounded">
          <p className="text-sm text-text-muted">No strings defined</p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-3 overflow-y-auto scrollbar-dark pr-2 content-start">
          {state.strings?.map((string, index) => {
            // Get active flags for badge display
            const activeFlags = [
              string.identifier && {
                label: "Identifier",
                color: "bg-blue-500/20 text-blue-400 border-blue-500/50",
              },
              string.inputText && {
                label: "Input Text",
                color:
                  "bg-green-500/20 text-green-400 border-green-500/50",
              },
              string.expectedText && {
                label: "Expected",
                color:
                  "bg-purple-500/20 text-purple-400 border-purple-500/50",
              },
              string.regexPattern && {
                label: "Regex",
                color:
                  "bg-orange-500/20 text-orange-400 border-orange-500/50",
              },
            ].filter(Boolean) as Array<{ label: string; color: string }>;

            return (
              <div
                key={string.id}
                className="rounded-lg overflow-hidden border-l-4 border-l-[#FFD700] bg-[#FFD700]/[0.03]"
              >
                {/* Header bar with index */}
                <div className="bg-[#FFD700]/15 px-3 py-2 flex items-center gap-2">
                  <span className="text-[#FFD700] text-xs font-bold min-w-[1.25rem]">
                    {index + 1}
                  </span>
                  <span className="text-text-secondary text-xs font-medium truncate flex-1">
                    {string.name || "Unnamed"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
                    onClick={() => removeString(index)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <div className="p-3 space-y-2">
                  {/* Name input */}
                  <div className="flex items-center gap-2">
                    <Input
                      value={string.name}
                      onChange={(e) =>
                        updateString(index, "name", e.target.value)
                      }
                      className="flex-1 h-7 bg-surface-canvas border-border-subtle text-text-secondary text-xs"
                      placeholder="String name"
                    />
                  </div>

                  {/* Active Flags Badges */}
                  {activeFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {activeFlags.map((flag) => (
                        <Badge
                          key={flag.label}
                          variant="outline"
                          className={`text-xs px-2 py-0.5 ${flag.color} border`}
                        >
                          {flag.label}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Type Flags Checkboxes */}
                  <div className="space-y-1.5 pt-1 border-t border-border-default">
                    <Label className="text-xs text-text-muted font-semibold">
                      Type Flags
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {/* Identifier Checkbox */}
                      <div
                        className="flex items-center space-x-1.5"
                        title="Use for OCR verification - the string will be searched for in the image"
                      >
                        <Checkbox
                          id={`string-identifier-${string.id}`}
                          checked={string.identifier || false}
                          onCheckedChange={(checked) =>
                            updateString(
                              index,
                              "identifier",
                              checked as boolean
                            )
                          }
                          className="border-border-subtle data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                        />
                        <Label
                          htmlFor={`string-identifier-${string.id}`}
                          className="text-xs text-text-secondary cursor-pointer"
                        >
                          Identifier
                        </Label>
                        <Info className="w-3 h-3 text-text-muted" />
                      </div>

                      {/* Input Text Checkbox (DEFAULT) */}
                      <div
                        className="flex items-center space-x-1.5"
                        title="Text to be typed - will be typed into the active field"
                      >
                        <Checkbox
                          id={`string-inputtext-${string.id}`}
                          checked={
                            string.inputText !== undefined
                              ? string.inputText
                              : true
                          }
                          onCheckedChange={(checked) =>
                            updateString(
                              index,
                              "inputText",
                              checked as boolean
                            )
                          }
                          className="border-border-subtle data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                        />
                        <Label
                          htmlFor={`string-inputtext-${string.id}`}
                          className="text-xs text-text-secondary cursor-pointer"
                        >
                          Input Text
                        </Label>
                        <Info className="w-3 h-3 text-text-muted" />
                      </div>

                      {/* Expected Text Checkbox */}
                      <div
                        className="flex items-center space-x-1.5"
                        title="Expected text for validation - used to verify expected content"
                      >
                        <Checkbox
                          id={`string-expected-${string.id}`}
                          checked={string.expectedText || false}
                          onCheckedChange={(checked) =>
                            updateString(
                              index,
                              "expectedText",
                              checked as boolean
                            )
                          }
                          className="border-border-subtle data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
                        />
                        <Label
                          htmlFor={`string-expected-${string.id}`}
                          className="text-xs text-text-secondary cursor-pointer"
                        >
                          Expected Text
                        </Label>
                        <Info className="w-3 h-3 text-text-muted" />
                      </div>

                      {/* Regex Pattern Checkbox */}
                      <div
                        className="flex items-center space-x-1.5"
                        title="Regex pattern - the value will be treated as a regular expression"
                      >
                        <Checkbox
                          id={`string-regex-${string.id}`}
                          checked={string.regexPattern || false}
                          onCheckedChange={(checked) =>
                            updateString(
                              index,
                              "regexPattern",
                              checked as boolean
                            )
                          }
                          className="border-border-subtle data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        />
                        <Label
                          htmlFor={`string-regex-${string.id}`}
                          className="text-xs text-text-secondary cursor-pointer"
                        >
                          Regex Pattern
                        </Label>
                        <Info className="w-3 h-3 text-text-muted" />
                      </div>
                    </div>

                    {/* Regex Warning Message */}
                    {string.regexPattern && (
                      <div className="flex items-start gap-2 p-2 bg-orange-500/10 border border-orange-500/30 rounded mt-2">
                        <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-orange-300">
                          <div className="font-semibold mb-0.5">
                            Regex Mode Active
                          </div>
                          <div className="text-orange-400/80">
                            The value will be interpreted as a regular
                            expression pattern. Special characters like .,
                            *, +, ?, etc. have special meaning.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* String Value */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-text-muted">
                        Value
                      </Label>
                      <SpecialKeysSelector
                        onInsertKey={(newText) =>
                          updateString(index, "value", newText)
                        }
                        textAreaRef={
                          stringTextAreaRefs.current[string.id]
                            ? {
                                current:
                                  stringTextAreaRefs.current[string.id]!,
                              }
                            : undefined
                        }
                      />
                    </div>
                    <Textarea
                      ref={setStringTextAreaRef(string.id)}
                      value={string.value}
                      onChange={(e) =>
                        updateString(index, "value", e.target.value)
                      }
                      className="w-full min-h-[60px] bg-surface-canvas border-border-subtle text-text-secondary text-xs font-mono"
                      placeholder="String value"
                      rows={2}
                    />
                    {string.value && (
                      <div className="p-2 bg-surface-canvas/50 rounded-md border border-border-default">
                        <div className="text-xs text-text-muted mb-1">
                          Preview:
                        </div>
                        <div className="text-xs font-mono text-text-secondary break-all">
                          <SpecialKeyDisplay text={string.value} />
                        </div>
                      </div>
                    )}
                  </div>
                  <MonitorSelector
                    monitors={string.monitors || [0]}
                    onChange={(monitors) =>
                      updateString(index, "monitors", monitors)
                    }
                    label="Monitors"
                    showLabel={true}
                    showConnectionStatus={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </TabsContent>
  );
}
