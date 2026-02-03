/**
 * SequentialEditor Component
 *
 * Timeline-based action editor for sequential processes.
 * Extracted from ActionEditor to be reusable with both Process and Workflow formats.
 */

"use client";

import { useState } from "react";
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
      type: "FIND",
      label: "Find State",
      color: "bg-cyan-500",
      preset: "stateImage",
    },
    { type: "RAG_FIND", label: "RAG Find", color: "bg-violet-500" },
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
  Variables: [
    { type: "SET_VARIABLE", label: "Set Variable", color: "bg-emerald-500" },
    { type: "GET_VARIABLE", label: "Get Variable", color: "bg-emerald-600" },
  ],
  Verification: [
    { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  ],
  Shell: [
    { type: "SHELL", label: "Run Command", color: "bg-slate-500" },
    { type: "SHELL_SCRIPT", label: "Run Script", color: "bg-slate-600" },
  ],
  AI: [{ type: "AI_PROMPT", label: "AI Prompt", color: "bg-violet-500" }],
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

  const addAction = (
    type: Action["type"],
    insertAfterIndex?: number,
    preset?: string
  ) => {
    let config = getDefaultConfig(type);

    // Handle presets for FIND action
    if (type === "FIND" && preset === "stateImage") {
      config = {
        target: {
          type: "stateImage",
          stateId: "",
          imageIds: [],
        },
      } as typeof config;
    }

    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config,
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
              data-ui-id="automation-sequential-addaction-btn"
              className="bg-brand-secondary hover:bg-brand-secondary/80 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Action
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-surface-raised border-border-default">
            {Object.entries(ACTION_GROUPS).map(([groupName, actions]) => (
              <DropdownMenuSub key={groupName}>
                <DropdownMenuSubTrigger className="hover:bg-surface-raised focus:bg-surface-raised">
                  {groupName}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="bg-surface-raised border-border-default">
                  {actions.map((actionTemplate) => (
                    <DropdownMenuItem
                      key={`${actionTemplate.type}-${"preset" in actionTemplate ? actionTemplate.preset : "default"}`}
                      onClick={() =>
                        addAction(
                          actionTemplate.type as Action["type"],
                          undefined,
                          "preset" in actionTemplate
                            ? actionTemplate.preset
                            : undefined
                        )
                      }
                      className="hover:bg-surface-raised focus:bg-surface-raised"
                    >
                      {actionTemplate.label}
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
          <div className="text-center py-12 text-text-muted border-2 border-dashed border-border-default rounded-lg">
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
                <div key={action.id}>
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
                            className="h-5 w-8 p-0 text-text-muted hover:text-brand-secondary hover:bg-brand-secondary/10 rounded"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-surface-raised border-border-default">
                          {Object.entries(ACTION_GROUPS).map(
                            ([groupName, actions]) => (
                              <DropdownMenuSub key={groupName}>
                                <DropdownMenuSubTrigger className="hover:bg-surface-raised focus:bg-surface-raised">
                                  {groupName}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="bg-surface-raised border-border-default">
                                  {actions.map((actionTemplate) => (
                                    <DropdownMenuItem
                                      key={`${actionTemplate.type}-${"preset" in actionTemplate ? actionTemplate.preset : "default"}`}
                                      onClick={() =>
                                        addAction(
                                          actionTemplate.type as Action["type"],
                                          index - 1,
                                          "preset" in actionTemplate
                                            ? actionTemplate.preset
                                            : undefined
                                        )
                                      }
                                      className="hover:bg-surface-raised focus:bg-surface-raised"
                                    >
                                      {actionTemplate.label}
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
                      <div className="w-full border-t border-border-subtle" />
                    </div>
                  </div>

                  {/* Compact Action Card */}
                  <Card
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`cursor-move transition-all hover:border-brand-secondary/50 ${
                      selectedAction?.id === action.id
                        ? "border-brand-secondary bg-brand-secondary/10"
                        : "border-border-default bg-surface-raised"
                    } ${draggedIndex === index ? "opacity-50" : ""}`}
                    onClick={() => onSelectAction(action)}
                  >
                    <CardContent className="p-2 px-3">
                      <div className="flex items-center gap-2">
                        {/* Drag Handle & Number */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <GripVertical className="w-3.5 h-3.5 text-text-muted cursor-grab active:cursor-grabbing" />
                          <Badge
                            className={`${actionType?.color ?? "bg-surface-raised"} text-white text-xs px-1.5 py-0 h-5 min-w-[1.5rem] flex items-center justify-center`}
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
                          <div className="text-xs text-text-muted truncate">
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
                            className="h-6 w-6 p-0 text-text-muted hover:text-brand-primary hover:bg-brand-primary/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateAction(action);
                            }}
                            data-ui-id={`automation-sequential-action-${action.id}-duplicate-btn`}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-text-muted hover:text-red-400 hover:bg-red-400/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAction(action.id);
                            }}
                            data-ui-id={`automation-sequential-action-${action.id}-delete-btn`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
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
                      className="h-5 w-8 p-0 text-text-muted hover:text-brand-secondary hover:bg-brand-secondary/10 rounded"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-surface-raised border-border-default">
                    {Object.entries(ACTION_GROUPS).map(
                      ([groupName, actions]) => (
                        <DropdownMenuSub key={groupName}>
                          <DropdownMenuSubTrigger className="hover:bg-surface-raised focus:bg-surface-raised">
                            {groupName}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="bg-surface-raised border-border-default">
                            {actions.map((actionTemplate) => (
                              <DropdownMenuItem
                                key={`${actionTemplate.type}-${"preset" in actionTemplate ? actionTemplate.preset : "default"}`}
                                onClick={() =>
                                  addAction(
                                    actionTemplate.type as Action["type"],
                                    actions.length - 1,
                                    "preset" in actionTemplate
                                      ? actionTemplate.preset
                                      : undefined
                                  )
                                }
                                className="hover:bg-surface-raised focus:bg-surface-raised"
                              >
                                {actionTemplate.label}
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
                <div className="w-full border-t border-border-subtle" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Helper functions (copied from action-editor.tsx)
function getDefaultConfig(type: Action["type"]): Record<string, unknown> {
  switch (type) {
    case "FIND":
      return {
        target: {
          type: "image",
          imageId: null,
        },
      };
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
    case "RAG_FIND":
      return {
        target: {
          type: "stateImage",
          stateImageId: "",
        },
        topK: 1,
        outputVariable: "",
      };
    case "GO_TO_STATE":
      return { stateIds: [] }; // Array of state IDs for multi-target pathfinding
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
    case "KEY_PRESS":
      return { key: "" };
    case "KEY_DOWN":
      return { key: "" };
    case "KEY_UP":
      return { key: "" };
    case "SHELL":
      return {
        command: "",
        shell: "bash",
        outputFormat: "text",
        timeout: 30000,
        failOnError: true,
      };
    case "SHELL_SCRIPT":
      return {
        script: "",
        shell: "bash",
        outputFormat: "text",
        timeout: 60000,
        failOnError: true,
      };
    case "AI_PROMPT":
      return {
        provider: "claude",
        prompt: "",
        freshContext: true,
        timeout: 600000,
        failOnError: true,
      };
    default:
      return {};
  }
}

interface StateType {
  id: string;
  name: string;
  stateImages?: Array<{ id: string; name: string }>;
  strings?: Array<{ id: string; value: string; name?: string }>;
}

interface WorkflowType {
  id: string;
  name: string;
}

interface ImageType {
  id: string;
  name: string;
}

function getActionSummary(
  action: Action,
  states: StateType[],
  workflows: WorkflowType[],
  images: ImageType[]
): string {
  const config = action.config as Record<string, unknown>;

  switch (action.type) {
    case "FIND": {
      if (config.removedImage) {
        return `[REMOVED: ${config.removedImage as string}]`;
      }

      // Handle stateImage target type (Find State)
      const target = config.target as
        | {
            type?: string;
            stateId?: string;
            imageId?: string;
            imageIds?: string[];
          }
        | undefined;
      if (target?.type === "stateImage") {
        const stateId = target.stateId;
        if (stateId) {
          const state = states.find((s) => s.id === stateId);
          return state
            ? `Find any image from ${state.name}`
            : "State not found";
        }
        return "No state selected";
      }

      // Handle new target structure with imageIds array
      const imageIds = target?.type === "image" ? target.imageIds : null;
      const imageId =
        imageIds?.[0] ||
        target?.imageId ||
        (config.image as string | undefined);

      if (imageId) {
        let stateImageName: string | null = null;
        for (const state of states) {
          const stateImage = state.stateImages?.find((si) => si.id === imageId);
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
    case "CLICK": {
      const clickConfig = config as {
        mouseButton?: string;
        target?:
          | string
          | { type?: string; imageId?: string; imageIds?: string[] };
        stateId?: string;
        imageIds?: string[];
      };
      const button = clickConfig.mouseButton?.toLowerCase() || "left";

      // Helper to get image name by ID
      const getImageName = (imgId: string): string | null => {
        for (const s of states) {
          const img = s.stateImages?.find((si) => si.id === imgId);
          if (img) {
            return img.name.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, "");
          }
        }
        return null;
      };

      // Handle object target format: { type: "StateImage" | "image", imageId?: string, imageIds?: string[] }
      // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
      if (clickConfig.target && typeof clickConfig.target === "object") {
        const targetObj = clickConfig.target;
        const targetType = targetObj.type;

        if (
          targetType === "StateImage" ||
          targetType === "stateImage" ||
          targetType === "image"
        ) {
          // Single imageId
          if (targetObj.imageId) {
            const name = getImageName(targetObj.imageId);
            if (name) {
              return `${button} click on ${name}`;
            }
            return `${button} click on image`;
          }
          // Multiple imageIds
          if (targetObj.imageIds && targetObj.imageIds.length > 0) {
            const names = targetObj.imageIds
              .map((id) => getImageName(id))
              .filter((n): n is string => n !== null);
            if (names.length === 1) {
              return `${button} click on ${names[0]}`;
            } else if (names.length > 1) {
              return `${button} click on ${names[0]} +${names.length - 1} more`;
            }
            return `${button} click on image`;
          }
          return `${button} click on StateImage (no image selected)`;
        }

        if (targetType === "lastFindResult") {
          return `${button} click on last find result`;
        }
        if (targetType === "currentPosition") {
          return `${button} click at current position`;
        }
        if (targetType === "coordinates") {
          return `${button} click at coordinates`;
        }

        // Unknown object type - stringify for debugging
        return `${button} click on ${targetType || "target"}`;
      }

      // Handle legacy string target format: "StateImage"
      // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
      if (
        clickConfig.target === "StateImage" ||
        clickConfig.target === "stateImage"
      ) {
        // Check imageIds first (new flow without requiring stateId)
        if (clickConfig.imageIds && clickConfig.imageIds.length > 0) {
          // Get image names from all states
          const names: string[] = [];
          for (const imgId of clickConfig.imageIds) {
            const name = getImageName(imgId);
            if (name) {
              names.push(name);
            }
          }

          if (names.length === 1) {
            return `${button} click on ${names[0]}`;
          } else if (names.length > 1) {
            return `${button} click on ${names[0]} +${names.length - 1} more`;
          }
        }

        // Legacy: check stateId if imageIds not available
        if (clickConfig.stateId) {
          const state = states.find((s) => s.id === clickConfig.stateId);
          const stateName = state?.name || clickConfig.stateId;
          return `${button} click on any image from ${stateName}`;
        }

        return `${button} click on StateImage (no image selected)`;
      }

      // Handle other string targets
      if (typeof clickConfig.target === "string") {
        return `${button} click on ${clickConfig.target}`;
      }

      return `${button} click on target`;
    }
    case "TYPE": {
      const typeConfig = config as {
        text?: string;
        textSource?: { stateId: string; stringIds: string[] };
      };
      if (typeConfig.textSource) {
        const stateId = typeConfig.textSource.stateId;
        if (!stateId) return "No state selected";
        const state = states.find((s) => s.id === stateId);
        if (!state) return "Invalid state";
        if (typeConfig.textSource.stringIds?.length > 0 && state.strings) {
          const selectedStrings = state.strings
            .filter((s) => typeConfig.textSource!.stringIds.includes(s.id))
            .map((s) => s.value)
            .filter((v) => v);
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
        if (!typeConfig.text) return "No text specified";
        const displayText =
          typeConfig.text.length > 30
            ? typeConfig.text.substring(0, 30) + "..."
            : typeConfig.text;
        return `Type "${displayText.replace(/\n/g, "↵").replace(/\t/g, "→")}"`;
      }
    }
    case "DRAG": {
      const dragConfig = config as {
        source?: unknown;
        destination?: unknown;
      };
      return `Drag from ${dragConfig.source || "source"} to ${dragConfig.destination || "destination"}`;
    }
    case "SCROLL": {
      const scrollConfig = config as { direction?: string; clicks?: number };
      return `Scroll ${scrollConfig.direction} ${scrollConfig.clicks || 1} clicks`;
    }
    case "VANISH": {
      const vanishConfig = config as {
        target?: { type?: string; imageId?: string };
      };
      const vanishImageId =
        vanishConfig.target?.type === "image"
          ? vanishConfig.target.imageId
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
    case "RAG_FIND": {
      const ragConfig = config as {
        target?: { stateImageId?: string };
        topK?: number;
      };
      const stateImageId = ragConfig.target?.stateImageId;
      if (stateImageId) {
        // Find StateImage across all states
        for (const state of states) {
          const stateImage = state.stateImages?.find(
            (si) => si.id === stateImageId
          );
          if (stateImage) {
            const nameWithoutExtension = stateImage.name.replace(
              /\.(png|jpg|jpeg|gif|webp|svg)$/i,
              ""
            );
            return `RAG Find: ${nameWithoutExtension}${ragConfig.topK && ragConfig.topK > 1 ? ` (top ${ragConfig.topK})` : ""}`;
          }
        }
        return "StateImage not found";
      }
      return "No element selected";
    }
    case "GO_TO_STATE": {
      const gotoConfig = config as {
        stateIds?: string[];
        states?: string[];
        stateId?: string;
      };
      // Support new format (stateIds), old format (states), and legacy format (stateId)
      const stateIdList =
        gotoConfig.stateIds ||
        gotoConfig.states ||
        (gotoConfig.stateId ? [gotoConfig.stateId] : []);

      if (stateIdList.length > 0) {
        const stateNames = stateIdList
          .map((id) => {
            const state = states.find((s) => s.id === id);
            return state ? state.name : id;
          })
          .filter(Boolean);

        if (stateNames.length === 0) {
          return "No state selected";
        } else if (stateNames.length === 1) {
          return `Target: ${stateNames[0]}`;
        } else {
          return `Targets: ${stateNames.join(", ")}`;
        }
      }
      return "No state selected";
    }
    case "RUN_WORKFLOW": {
      const workflowConfig = config as { workflowId?: string };
      if (workflowConfig.workflowId) {
        const workflow = workflows.find(
          (w) => w.id === workflowConfig.workflowId
        );
        return workflow ? workflow.name : workflowConfig.workflowId;
      }
      return "No workflow selected";
    }
    case "IF": {
      const ifConfig = config as {
        thenActions?: unknown[];
        elseActions?: unknown[];
        condition?: { type?: string };
      };
      const thenCount = ifConfig.thenActions?.length || 0;
      const elseCount = ifConfig.elseActions?.length || 0;
      const conditionType = ifConfig.condition?.type || "not configured";
      if (elseCount > 0) {
        return `${conditionType} condition: ${thenCount} then-actions, ${elseCount} else-actions`;
      } else {
        return `${conditionType} condition: ${thenCount} then-actions`;
      }
    }
    case "LOOP": {
      const loopConfig = config as {
        loopType?: string;
        actions?: unknown[];
        iterations?: number;
      };
      const loopType = loopConfig.loopType || "FOR";
      const actionCount = loopConfig.actions?.length || 0;
      if (loopType === "FOR") {
        const iterations = loopConfig.iterations || 0;
        return `FOR loop: ${iterations} iterations, ${actionCount} actions`;
      } else if (loopType === "WHILE") {
        return `WHILE loop: ${actionCount} actions`;
      } else {
        return `FOREACH loop: ${actionCount} actions`;
      }
    }
    case "MOUSE_MOVE": {
      const config = action.config as {
        target?: unknown;
        x?: number;
        y?: number;
      };
      if (config.target === "Coordinates") {
        return `Move mouse to (${config.x}, ${config.y})`;
      }
      return `Move mouse to ${config.target}`;
    }
    case "MOUSE_DOWN": {
      const config = action.config as {
        target?: string;
        button?: string;
        x?: number;
        y?: number;
        mouseButton?: string;
      };
      if (config.target === "Coordinates") {
        return `Press ${config.button || config.mouseButton || "left"} button at (${config.x}, ${config.y})`;
      }
      return `Press ${config.button || config.mouseButton || "left"} button${config.target ? ` at ${config.target}` : ""}`;
    }
    case "MOUSE_UP": {
      const config = action.config as {
        target?: string;
        button?: string;
        x?: number;
        y?: number;
        mouseButton?: string;
      };
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
    case "SHELL": {
      const config = action.config as {
        command?: string;
        shell?: string;
        description?: string;
      };
      if (config.description) {
        return config.description;
      }
      if (config.command) {
        const displayCmd =
          config.command.length > 40
            ? config.command.substring(0, 40) + "..."
            : config.command;
        return `${config.shell || "sh"}: ${displayCmd}`;
      }
      return "No command specified";
    }
    case "SHELL_SCRIPT": {
      const config = action.config as {
        script?: string;
        shell?: string;
        description?: string;
      };
      if (config.description) {
        return config.description;
      }
      if (config.script) {
        const lines = config.script.split("\n").filter((l) => l.trim());
        return `${config.shell || "bash"} script (${lines.length} lines)`;
      }
      return "No script specified";
    }
    case "AI_PROMPT": {
      const config = action.config as {
        provider?: string;
        prompt?: string;
        description?: string;
      };
      if (config.description) {
        return config.description;
      }
      const provider = config.provider || "claude";
      if (config.prompt) {
        const displayPrompt =
          config.prompt.length > 40
            ? config.prompt.substring(0, 40) + "..."
            : config.prompt;
        return `AI Prompt (${provider}): ${displayPrompt}`;
      }
      return `AI Prompt (${provider})`;
    }
    default:
      return "Configure action";
  }
}
