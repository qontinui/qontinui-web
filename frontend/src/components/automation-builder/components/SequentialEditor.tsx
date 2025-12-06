/**
 * SequentialEditor Component
 *
 * Timeline-based action editor for sequential processes.
 * Extracted from ActionEditor to be reusable with both Process and Workflow formats.
 */

"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Plus, GripVertical, Trash2, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAutomation } from "@/contexts/automation-context";
import type { SequentialEditorProps } from "../types";
import type { Action } from "@/lib/action-schema/action-types";

const ACTION_GROUPS = {
  Find: [
    { type: "FIND", label: "Find Element", color: "bg-blue-500" },
    {
      type: "FIND_STATE_IMAGE",
      label: "Find State Image",
      color: "bg-cyan-500",
    },
  ],
  Mouse: [
    { type: "CLICK", label: "Click", color: "bg-green-500" },
    { type: "DOUBLE_CLICK", label: "Double Click", color: "bg-green-600" },
    { type: "RIGHT_CLICK", label: "Right Click", color: "bg-green-700" },
    { type: "DRAG", label: "Drag & Drop", color: "bg-purple-500" },
    { type: "SCROLL", label: "Scroll", color: "bg-orange-500" },
    { type: "MOUSE_MOVE", label: "Mouse Move", color: "bg-teal-500" },
    { type: "MOUSE_DOWN", label: "Mouse Down", color: "bg-teal-600" },
    { type: "MOUSE_UP", label: "Mouse Up", color: "bg-teal-700" },
  ],
  Keyboard: [
    { type: "TYPE", label: "Type Text", color: "bg-yellow-500" },
    { type: "KEY_PRESS", label: "Key Press", color: "bg-amber-500" },
    { type: "KEY_DOWN", label: "Key Down", color: "bg-amber-600" },
    { type: "KEY_UP", label: "Key Up", color: "bg-amber-700" },
  ],
  "Control Flow": [
    { type: "IF", label: "If/Else", color: "bg-blue-500" },
    { type: "LOOP", label: "Loop", color: "bg-purple-500" },
    { type: "GO_TO_STATE", label: "Go to State", color: "bg-indigo-500" },
    { type: "RUN_WORKFLOW", label: "Run Workflow", color: "bg-pink-500" },
  ],
  Verification: [
    { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  ],
} as const;

// Flat list for finding action types by type
const ACTION_TYPES = Object.values(ACTION_GROUPS).flat();

export function SequentialEditor({
  actions,
  selectedAction,
  onSelectAction,
  onUpdateActions,
}: SequentialEditorProps) {
  const { states, workflows, images } = useAutomation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null);

  const addAction = (type: Action["type"], insertAfterIndex?: number) => {
    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config: getDefaultConfig(type),
      position: [100, 100 + actions.length * 150], // Auto-position vertically
    };

    if (insertAfterIndex !== undefined && insertAfterIndex >= -1) {
      // Insert at specific position
      const updatedActions = [...actions];
      updatedActions.splice(insertAfterIndex + 1, 0, newAction);
      onUpdateActions(updatedActions);
    } else {
      // Add to end
      onUpdateActions([...actions, newAction]);
    }

    onSelectAction(newAction);
    setInsertAtIndex(null);
  };

  const deleteAction = (actionId: string) => {
    const updatedActions = actions.filter((a) => a.id !== actionId);
    onUpdateActions(updatedActions);

    if (selectedAction?.id === actionId) {
      onSelectAction(updatedActions[0] || null);
    }
  };

  const duplicateAction = (action: Action) => {
    const newAction: Action = {
      ...action,
      id: `action-${Date.now()}`,
    };

    const actionIndex = actions.findIndex((a) => a.id === action.id);
    const updatedActions = [...actions];
    updatedActions.splice(actionIndex + 1, 0, newAction);

    onUpdateActions(updatedActions);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === index) return;

    const updatedActions = [...actions];
    const draggedAction = updatedActions[draggedIndex];

    if (!draggedAction) return;

    // Remove from old position
    updatedActions.splice(draggedIndex, 1);
    // Insert at new position
    updatedActions.splice(index, 0, draggedAction);

    onUpdateActions(updatedActions);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="p-6 min-h-full flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-3xl flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">Action Timeline</h3>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              data-tutorial-id="add-action-button"
              className="bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Action
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-[#27272A] border-gray-700">
            {Object.entries(ACTION_GROUPS).map(([groupName, actions]) => (
              <DropdownMenuSub key={groupName}>
                <DropdownMenuSubTrigger className="hover:bg-gray-700 focus:bg-gray-700">
                  {groupName}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="bg-[#27272A] border-gray-700">
                  {actions.map(({ type, label }) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => addAction(type as Action["type"])}
                      className="hover:bg-gray-700 focus:bg-gray-700"
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Timeline Container */}
      <div className="w-full max-w-3xl space-y-1">
        {actions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
            <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No actions yet</p>
            <p className="text-sm">Add an action to get started</p>
          </div>
        ) : (
          <>
            {actions.map((action, index) => {
              const actionType = ACTION_TYPES.find(
                (t) => t.type === action.type
              );
              return (
                <React.Fragment key={action.id}>
                  {/* Compact Insert Button */}
                  <div className="relative h-4 group">
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu
                        open={insertAtIndex === index - 1}
                        onOpenChange={(open) =>
                          setInsertAtIndex(open ? index - 1 : null)
                        }
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-8 p-0 text-gray-500 hover:text-[#BD00FF] hover:bg-[#BD00FF]/10 rounded"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-[#27272A] border-gray-700">
                          {Object.entries(ACTION_GROUPS).map(
                            ([groupName, actions]) => (
                              <DropdownMenuSub key={groupName}>
                                <DropdownMenuSubTrigger className="hover:bg-gray-700 focus:bg-gray-700">
                                  {groupName}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="bg-[#27272A] border-gray-700">
                                  {actions.map(({ type, label }) => (
                                    <DropdownMenuItem
                                      key={type}
                                      onClick={() =>
                                        addAction(
                                          type as Action["type"],
                                          index - 1
                                        )
                                      }
                                      className="hover:bg-gray-700 focus:bg-gray-700"
                                    >
                                      {label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="absolute inset-0 flex items-center pointer-events-none">
                      <div className="w-full border-t border-gray-800" />
                    </div>
                  </div>

                  {/* Compact Action Card */}
                  <Card
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`cursor-move transition-all hover:border-[#BD00FF]/50 ${
                      selectedAction?.id === action.id
                        ? "border-[#BD00FF] bg-[#BD00FF]/10"
                        : "border-gray-700 bg-[#27272A]"
                    } ${draggedIndex === index ? "opacity-50" : ""}`}
                    onClick={() => onSelectAction(action)}
                  >
                    <CardContent className="p-2 px-3">
                      <div className="flex items-center gap-2">
                        {/* Drag Handle & Number */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <GripVertical className="w-3.5 h-3.5 text-gray-500 cursor-grab active:cursor-grabbing" />
                          <Badge
                            className={`${actionType?.color ?? "bg-gray-500"} text-white text-xs px-1.5 py-0 h-5 min-w-[1.5rem] flex items-center justify-center`}
                          >
                            {index + 1}
                          </Badge>
                        </div>

                        {/* Action Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm truncate">
                              {actionType?.label ?? action.type}
                            </span>
                            {action.type !== "GO_TO_STATE" &&
                              action.type !== "RUN_WORKFLOW" && (
                                <Badge
                                  variant="outline"
                                  className="text-xs px-1 py-0 h-4"
                                >
                                  {action.type}
                                </Badge>
                              )}
                          </div>
                          <div className="text-xs text-gray-400 truncate">
                            {getActionSummary(
                              action,
                              states,
                              workflows,
                              images
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-gray-500 hover:text-[#00D9FF] hover:bg-[#00D9FF]/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateAction(action);
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-gray-500 hover:text-red-400 hover:bg-red-400/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAction(action.id);
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </React.Fragment>
              );
            })}

            {/* Insert button after last action */}
            <div className="relative h-4 group">
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu
                  open={insertAtIndex === actions.length - 1}
                  onOpenChange={(open) =>
                    setInsertAtIndex(open ? actions.length - 1 : null)
                  }
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-8 p-0 text-gray-500 hover:text-[#BD00FF] hover:bg-[#BD00FF]/10 rounded"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-[#27272A] border-gray-700">
                    {Object.entries(ACTION_GROUPS).map(
                      ([groupName, actions]) => (
                        <DropdownMenuSub key={groupName}>
                          <DropdownMenuSubTrigger className="hover:bg-gray-700 focus:bg-gray-700">
                            {groupName}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="bg-[#27272A] border-gray-700">
                            {actions.map(({ type, label }) => (
                              <DropdownMenuItem
                                key={type}
                                onClick={() =>
                                  addAction(
                                    type as Action["type"],
                                    actions.length - 1
                                  )
                                }
                                className="hover:bg-gray-700 focus:bg-gray-700"
                              >
                                {label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="absolute inset-0 flex items-center pointer-events-none">
                <div className="w-full border-t border-gray-800" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Helper functions (copied from action-editor.tsx)
function getDefaultConfig(type: Action["type"]): Record<string, any> {
  switch (type) {
    case "FIND":
      return {
        target: {
          type: "image",
          imageId: null,
        },
      };
    case "FIND_STATE_IMAGE":
      return { state: null };
    case "CLICK":
      return {
        target: "Last Find Result",
        mouseButton: "LEFT",
        numberOfClicks: 1,
        hold_duration: 0,
      };
    case "TYPE":
      return {
        text: "",
        textSource: "stateString",
        selectedState: null,
        selectedStateStrings: [],
        typing_delay: 50,
        clear_before: false,
        press_enter: false,
      };
    case "DRAG":
      return {
        from: "Last Find Result",
        to: null,
        drag_duration: 1000,
        smooth_movement: true,
      };
    case "SCROLL":
      return {
        direction: "down",
        amount: 3,
        scroll_duration: 500,
        smooth_scroll: true,
      };
    case "VANISH":
      return {
        target: {
          type: "image",
          imageId: null,
        },
        maxWaitTime: 5000,
        pollInterval: 500,
      };
    case "GO_TO_STATE":
      return { states: [] }; // Array of state IDs for multi-target pathfinding
    case "RUN_WORKFLOW":
      return { workflowId: "" };
    case "IF":
      return {
        condition: {
          type: "variable",
          variableName: "",
          operator: "==",
          expectedValue: "",
        },
        thenActions: [],
      };
    case "LOOP":
      return {
        loopType: "FOR",
        iterations: 10,
        actions: [],
        maxIterations: 1000,
        breakOnError: false,
      };
    case "MOUSE_MOVE":
      return { target: "Last Find Result", x: 0, y: 0, duration: 0 };
    case "MOUSE_DOWN":
      return { button: "left", target: null };
    case "MOUSE_UP":
      return { button: "left", target: null };
    case "DOUBLE_CLICK":
      return { target: "Last Find Result", mouseButton: "LEFT" };
    case "RIGHT_CLICK":
      return { target: "Last Find Result" };
    case "KEY_PRESS":
      return { key: "" };
    case "KEY_DOWN":
      return { key: "" };
    case "KEY_UP":
      return { key: "" };
    default:
      return {};
  }
}

function getActionSummary(
  action: Action,
  states: any[],
  workflows: any[],
  images: any[]
): string {
  switch (action.type) {
    case "FIND": {
      const config = action.config as any;
      if (config.removedImage) {
        return `[REMOVED: ${config.removedImage}]`;
      }
      // Handle new target structure with imageIds array
      const imageIds =
        config.target?.type === "image"
          ? config.target.imageIds
          : null;
      const imageId =
        imageIds?.[0] || config.target?.imageId || config.image;

      if (imageId) {
        let stateImageName = null;
        for (const state of states) {
          const stateImage = state.stateImages?.find(
            (si: any) => si.id === imageId
          );
          if (stateImage) {
            stateImageName = stateImage.name;
            break;
          }
        }
        if (stateImageName) {
          const nameWithoutExtension = stateImageName.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          const suffix =
            imageIds && imageIds.length > 1
              ? ` +${imageIds.length - 1} more`
              : "";
          return `Find ${nameWithoutExtension}${suffix}`;
        }
        const image = images.find((img) => img.id === imageId);
        if (image) {
          const nameWithoutExtension = image.name.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          const suffix =
            imageIds && imageIds.length > 1
              ? ` +${imageIds.length - 1} more`
              : "";
          return `Find ${nameWithoutExtension}${suffix}`;
        }
        return "Image not found";
      }
      return "No image selected";
    }
    case "FIND_STATE_IMAGE": {
      const config = action.config as { stateId?: string; imageId?: string };
      if (config.stateId) {
        const state = states.find((s) => s.id === config.stateId);
        return state ? `Find any image from ${state.name}` : "State not found";
      }
      return "No state selected";
    }
    case "CLICK": {
      const config = action.config as { mouseButton?: string; target?: string };
      return `${config.mouseButton?.toLowerCase() || "left"} click on ${config.target}`;
    }
    case "DOUBLE_CLICK": {
      const config = action.config as { target?: string };
      return `Double click on ${config.target || "Last Find Result"}`;
    }
    case "RIGHT_CLICK": {
      const config = action.config as { target?: string };
      return `Right click on ${config.target || "Last Find Result"}`;
    }
    case "TYPE": {
      const config = action.config as { text?: string; textSource?: { stateId: string; stringIds: string[] } };
      if (config.textSource) {
        const stateId = config.textSource.stateId;
        if (!stateId) return "No state selected";
        const state = states.find((s) => s.id === stateId);
        if (!state) return "Invalid state";
        if (config.textSource.stringIds?.length > 0 && state.strings) {
          const selectedStrings = state.strings
            .filter((s: any) =>
              config.textSource!.stringIds.includes(s.id)
            )
            .map((s: any) => s.value)
            .filter((v: any) => v);
          if (selectedStrings.length === 0) {
            return `No strings selected from ${state.name || state.id}`;
          }
          const combinedText = selectedStrings.join(" | ");
          const displayText =
            combinedText.length > 40
              ? combinedText.substring(0, 40) + "..."
              : combinedText;
          return `Type "${displayText.replace(/\n/g, "↵").replace(/\t/g, "→")}" (${state.name || state.id})`;
        } else {
          return `No strings selected from ${state.name || state.id}`;
        }
      } else {
        if (!config.text) return "No text specified";
        const displayText =
          config.text.length > 30
            ? config.text.substring(0, 30) + "..."
            : config.text;
        return `Type "${displayText.replace(/\n/g, "↵").replace(/\t/g, "→")}"`;
      }
    }
    case "DRAG": {
      const config = action.config as { source?: any; destination?: any };
      return `Drag from ${config.source || "source"} to ${config.destination || "destination"}`;
    }
    case "SCROLL": {
      const config = action.config as { direction?: string; clicks?: number };
      return `Scroll ${config.direction} ${config.clicks || 1} clicks`;
    }
    case "VANISH": {
      const config = action.config as { target?: { type?: string; imageId?: string } };
      const vanishImageId =
        config.target?.type === "image"
          ? config.target.imageId
          : undefined;
      if (vanishImageId) {
        const vanishImage = images.find((img) => img.id === vanishImageId);
        if (vanishImage) {
          const nameWithoutExtension = vanishImage.name.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          return `Wait for ${nameWithoutExtension} to vanish`;
        }
        return `Wait for ${vanishImageId} to vanish`;
      }
      return "No image selected";
    }
    case "GO_TO_STATE": {
      const config = action.config as { stateId?: string };
      if (config.stateId) {
        const state = states.find((s) => s.id === config.stateId);
        return state ? `Target: ${state.name}` : `Target: ${config.stateId}`;
      }
      return "No state selected";
    }
    case "RUN_WORKFLOW": {
      const config = action.config as { workflowId?: string };
      if (config.workflowId) {
        const workflow = workflows.find(
          (w: any) => w.id === config.workflowId
        );
        return workflow ? workflow.name : config.workflowId;
      }
      return "No workflow selected";
    }
    case "IF": {
      const config = action.config as { thenActions?: any[]; elseActions?: any[]; condition?: { type?: string } };
      const thenCount = config.thenActions?.length || 0;
      const elseCount = config.elseActions?.length || 0;
      const conditionType = config.condition?.type || "not configured";
      if (elseCount > 0) {
        return `${conditionType} condition: ${thenCount} then-actions, ${elseCount} else-actions`;
      } else {
        return `${conditionType} condition: ${thenCount} then-actions`;
      }
    }
    case "LOOP": {
      const config = action.config as { loopType?: string; actions?: any[]; iterations?: number };
      const loopType = config.loopType || "FOR";
      const actionCount = config.actions?.length || 0;
      if (loopType === "FOR") {
        const iterations = config.iterations || 0;
        return `FOR loop: ${iterations} iterations, ${actionCount} actions`;
      } else if (loopType === "WHILE") {
        return `WHILE loop: ${actionCount} actions`;
      } else {
        return `FOREACH loop: ${actionCount} actions`;
      }
    }
    case "MOUSE_MOVE": {
      const config = action.config as { target?: any; x?: number; y?: number };
      if (config.target === "Coordinates") {
        return `Move mouse to (${config.x}, ${config.y})`;
      }
      return `Move mouse to ${config.target}`;
    }
    case "MOUSE_DOWN": {
      const config = action.config as { target?: string; button?: string; x?: number; y?: number; mouseButton?: string };
      if (config.target === "Coordinates") {
        return `Press ${config.button || config.mouseButton || "left"} button at (${config.x}, ${config.y})`;
      }
      return `Press ${config.button || config.mouseButton || "left"} button${config.target ? ` at ${config.target}` : ""}`;
    }
    case "MOUSE_UP": {
      const config = action.config as { target?: string; button?: string; x?: number; y?: number; mouseButton?: string };
      if (config.target === "Coordinates") {
        return `Release ${config.button || config.mouseButton || "left"} button at (${config.x}, ${config.y})`;
      }
      return `Release ${config.button || config.mouseButton || "left"} button${config.target ? ` at ${config.target}` : ""}`;
    }
    case "KEY_PRESS": {
      const config = action.config as { key?: string; keys?: string[] };
      return config.key || config.keys?.[0]
        ? `Press key: ${config.key || config.keys?.[0]}`
        : "No key selected";
    }
    case "KEY_DOWN": {
      const config = action.config as { key?: string; keys?: string[] };
      return config.key || config.keys?.[0]
        ? `Hold key down: ${config.key || config.keys?.[0]}`
        : "No key selected";
    }
    case "KEY_UP": {
      const config = action.config as { key?: string; keys?: string[] };
      return config.key || config.keys?.[0]
        ? `Release key: ${config.key || config.keys?.[0]}`
        : "No key selected";
    }
    default:
      return "Configure action";
  }
}
