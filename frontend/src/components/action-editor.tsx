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

interface Process {
  id: string;
  name: string;
  description: string;
  actions: Action[];
}

interface Action {
  id: string;
  type: // Pure mouse actions
    | "MOUSE_MOVE"
    | "MOUSE_DOWN"
    | "MOUSE_UP"
    | "MOUSE_SCROLL"
    // Pure keyboard actions
    | "KEY_DOWN"
    | "KEY_UP"
    | "KEY_PRESS"
    | "HOTKEY"
    // Combined mouse actions
    | "CLICK"
    | "DOUBLE_CLICK"
    | "RIGHT_CLICK"
    | "DRAG"
    | "SCROLL"
    // Combined keyboard actions
    | "TYPE"
    // Control flow actions
    | "IF"
    | "LOOP"
    // Other actions
    | "FIND"
    | "VANISH"
    | "RAG_FIND"
    | "GO_TO_STATE"
    | "RUN_WORKFLOW";
  config: Record<string, unknown>;
}

interface ActionEditorProps {
  process: Process;
  selectedAction: Action | null;
  onSelectAction: (action: Action) => void;
  onUpdateProcess: (process: Process) => void;
}

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
  Verification: [
    { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  ],
} as const;

// Flat list for finding action types by type
const ACTION_TYPES = Object.values(ACTION_GROUPS).flat();

export function ActionEditor({
  process,
  selectedAction,
  onSelectAction,
  onUpdateProcess,
}: ActionEditorProps) {
  const { states, workflows, images } = useAutomation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const addAction = (type: Action["type"]) => {
    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config: getDefaultConfig(type),
    };

    const updatedProcess = {
      ...process,
      actions: [...process.actions, newAction],
    };

    onUpdateProcess(updatedProcess);
    onSelectAction(newAction);
  };

  const deleteAction = (actionId: string) => {
    const updatedProcess = {
      ...process,
      actions: process.actions.filter((a) => a.id !== actionId),
    };
    onUpdateProcess(updatedProcess);
    if (selectedAction?.id === actionId && process.actions[0]) {
      onSelectAction(process.actions[0]);
    }
  };

  const duplicateAction = (action: Action) => {
    const newAction: Action = {
      ...action,
      id: `action-${Date.now()}`,
    };

    const actionIndex = process.actions.findIndex((a) => a.id === action.id);
    const updatedActions = [...process.actions];
    updatedActions.splice(actionIndex + 1, 0, newAction);

    const updatedProcess = {
      ...process,
      actions: updatedActions,
    };

    onUpdateProcess(updatedProcess);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === index) return;

    const updatedActions = [...process.actions];
    const draggedAction = updatedActions[draggedIndex];

    if (!draggedAction) return;

    // Remove from old position
    updatedActions.splice(draggedIndex, 1);
    // Insert at new position
    updatedActions.splice(index, 0, draggedAction);

    onUpdateProcess({
      ...process,
      actions: updatedActions,
    });

    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Action Timeline</h3>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white">
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
                      onClick={() => addAction(type)}
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

      <div className="space-y-2">
        {process.actions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
            <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No actions yet</p>
            <p className="text-sm">Add an action to get started</p>
          </div>
        ) : (
          process.actions.map((action, index) => {
            const actionType = ACTION_TYPES.find((t) => t.type === action.type);
            return (
              <Card
                key={action.id}
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
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" />
                      <Badge
                        className={`${actionType?.color} text-white text-xs`}
                      >
                        {index + 1}
                      </Badge>
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{actionType?.label}</span>
                        {action.type !== "GO_TO_STATE" &&
                          action.type !== "RUN_WORKFLOW" && (
                            <Badge variant="outline" className="text-xs">
                              {action.type}
                            </Badge>
                          )}
                      </div>
                      {renderActionSummary(action, states, workflows, images)}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-[#00D9FF]"
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
                        className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
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
            );
          })
        )}
      </div>
    </div>
  );
}

function getDefaultConfig(type: Action["type"]): Record<string, unknown> {
  switch (type) {
    case "FIND":
      return {
        target: {
          type: "image",
          imageId: null,
        },
        // similarity, strategy, pause_before_begin, pause_after_end are optional overrides
      };
    case "CLICK":
      return {
        target: "Last Find Result",
        mouseButton: "LEFT",
        numberOfClicks: 1,
        hold_duration: 0,
        // pause_before_begin, pause_after_end are optional overrides
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
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "DRAG":
      return {
        from: "Last Find Result",
        to: null,
        drag_duration: 1000,
        smooth_movement: true,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "SCROLL":
      return {
        direction: "down",
        amount: 3,
        scroll_duration: 500,
        smooth_scroll: true,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "VANISH":
      return {
        target: {
          type: "image",
          imageId: null,
        },
        maxWaitTime: 5000,
        pollInterval: 500,
        // pause_before_begin, pause_after_end are optional overrides
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
      return {
        stateIds: [], // Array of state IDs for multi-target pathfinding
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "RUN_WORKFLOW":
      return {
        process: null,
        // pause_before_begin, pause_after_end are optional overrides
      };
    case "IF":
      return {
        condition: {
          type: "variable",
          variableName: "",
          operator: "==",
          expectedValue: "",
        },
        thenActions: [],
        // elseActions is optional
      };
    case "LOOP":
      return {
        loopType: "FOR",
        iterations: 10,
        actions: [],
        maxIterations: 1000,
        breakOnError: false,
      };

    // Pure mouse actions
    case "MOUSE_MOVE":
      return {
        target: "Last Find Result",
        x: 0,
        y: 0,
        duration: 0,
        // Optional timing overrides: move_default_duration
      };
    case "MOUSE_DOWN":
      return {
        button: "left",
        target: null, // Optional - can press at current position
        // No timing overrides needed (instantaneous)
      };
    case "MOUSE_UP":
      return {
        button: "left",
        target: null, // Optional - can release at current position
        // No timing overrides needed (instantaneous)
      };

    // Combined actions with timing overrides
    case "DOUBLE_CLICK":
      return {
        target: "Last Find Result",
        mouseButton: "LEFT",
        // Optional timing overrides: click_hold_duration, double_click_interval, etc.
      };
    case "RIGHT_CLICK":
      return {
        target: "Last Find Result",
        // Optional timing overrides: click_hold_duration, click_release_delay, etc.
      };

    // Pure keyboard actions
    case "KEY_PRESS":
      return {
        key: "",
        // Optional timing overrides: key_hold_duration, key_release_delay
      };
    case "KEY_DOWN":
      return {
        key: "",
        // No timing overrides needed (instantaneous press)
      };
    case "KEY_UP":
      return {
        key: "",
        // No timing overrides needed (instantaneous release)
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

function renderActionSummary(
  action: Action,
  states: StateType[],
  workflows: WorkflowType[],
  images: ImageType[]
) {
  const summary = getActionSummary(action, states, workflows, images);
  const hasRemovedImage = summary.includes("[REMOVED:");

  if (hasRemovedImage) {
    // Parse the summary to highlight removed image parts in red
    const parts = summary.split(/(\[REMOVED:[^\]]+\])/);
    return (
      <p className="text-xs mt-1">
        {parts.map((part, index) => {
          if (part.startsWith("[REMOVED:")) {
            return (
              <span key={index} className="text-red-400 font-medium">
                {part}
              </span>
            );
          }
          return (
            <span key={index} className="text-gray-400">
              {part}
            </span>
          );
        })}
      </p>
    );
  }

  return <p className="text-xs text-gray-400 mt-1">{summary}</p>;
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

      // Handle new target structure - support both imageId (singular) and imageIds (array)
      const imageIds = target?.type === "image" ? target.imageIds : null;
      const imageId =
        target?.type === "image"
          ? target.imageId
          : (config.image as string | undefined);

      // Handle imageIds array (multi-select)
      if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
        const names: string[] = [];
        for (const id of imageIds) {
          // Look for StateImage across all states
          let found = false;
          for (const state of states) {
            const stateImage = state.stateImages?.find((si) => si.id === id);
            if (stateImage) {
              const nameWithoutExtension = stateImage.name.replace(
                /\.(png|jpg|jpeg|gif|webp|svg)$/i,
                ""
              );
              names.push(nameWithoutExtension);
              found = true;
              break;
            }
          }
          if (!found) {
            // Fall back to image library
            const image = images.find((img) => img.id === id);
            if (image) {
              const nameWithoutExtension = image.name.replace(
                /\.(png|jpg|jpeg|gif|webp|svg)$/i,
                ""
              );
              names.push(nameWithoutExtension);
            }
          }
        }
        if (names.length === 1) {
          return `Find ${names[0]}`;
        } else if (names.length > 1) {
          return `Find ${names.length} images`;
        }
        return "Images not found";
      }

      // Handle single imageId (legacy format)
      if (imageId) {
        // First look for StateImage across all states
        let stateImageName: string | null = null;
        for (const state of states) {
          const stateImage = state.stateImages?.find((si) => si.id === imageId);
          if (stateImage) {
            stateImageName = stateImage.name;
            break;
          }
        }

        if (stateImageName) {
          // Remove file extension from StateImage name
          const nameWithoutExtension = stateImageName.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          return `Find ${nameWithoutExtension}`;
        }

        // Fall back to image library
        const image = images.find((img) => img.id === imageId);
        if (image) {
          // Remove file extension from image name
          const nameWithoutExtension = image.name.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          return `Find ${nameWithoutExtension}`;
        }
        return "Image not found";
      }
      return "No image selected";
    }
    case "RAG_FIND": {
      const ragTarget = config.target as { stateImageId?: string } | undefined;
      const stateImageId = ragTarget?.stateImageId;
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
            const topK = config.topK as number | undefined;
            return `RAG Find: ${nameWithoutExtension}${topK && topK > 1 ? ` (top ${topK})` : ""}`;
          }
        }
        return "StateImage not found";
      }
      return "No element selected";
    }
    case "CLICK": {
      const mouseButton = config.mouseButton as string | undefined;
      const button = mouseButton?.toLowerCase() || "left";
      const clickTarget = config.target as
        | string
        | { type?: string; imageId?: string; imageIds?: string[] }
        | undefined;

      // Helper to get image name by ID
      const getImageName = (imgId: string): string | null => {
        // Look for StateImage across all states
        for (const state of states) {
          const stateImage = state.stateImages?.find((si) => si.id === imgId);
          if (stateImage) {
            return stateImage.name.replace(
              /\.(png|jpg|jpeg|gif|webp|svg)$/i,
              ""
            );
          }
        }
        // Fall back to image library
        const image = images.find((img) => img.id === imgId);
        if (image) {
          return image.name.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, "");
        }
        return null;
      };

      // Handle object target format: { type: "StateImage" | "image", imageId?: string, imageIds?: string[] }
      if (clickTarget && typeof clickTarget === "object") {
        const targetObj = clickTarget;
        const targetType = targetObj.type;

        if (targetType === "StateImage" || targetType === "image") {
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

        // Unknown object type
        return `${button} click on ${targetType || "target"}`;
      }

      // Handle legacy string target format: "StateImage"
      if (clickTarget === "StateImage") {
        const clickImageIds = config.imageIds as string[] | undefined;
        if (
          clickImageIds &&
          Array.isArray(clickImageIds) &&
          clickImageIds.length > 0
        ) {
          const names: string[] = [];
          for (const id of clickImageIds) {
            const name = getImageName(id);
            if (name) {
              names.push(name);
            }
          }
          if (names.length === 1) {
            return `${button} click on ${names[0]}`;
          } else if (names.length > 1) {
            return `${button} click on ${names.length} images`;
          }
        }
        return `${button} click on StateImage (no image selected)`;
      }

      // Handle other string targets
      if (typeof clickTarget === "string") {
        return `${button} click on ${clickTarget}`;
      }

      return `${button} click on target`;
    }
    case "DOUBLE_CLICK":
      return `Double click on ${(config.target as string | undefined) || "Last Find Result"}`;
    case "RIGHT_CLICK":
      return `Right click on ${(config.target as string | undefined) || "Last Find Result"}`;
    case "MOUSE_MOVE": {
      const moveTarget = config.target as string | undefined;
      if (moveTarget === "Coordinates") {
        return `Move mouse to (${config.x as number}, ${config.y as number})`;
      }
      return `Move mouse to ${moveTarget || "target"}`;
    }
    case "MOUSE_DOWN": {
      const downTarget = config.target as string | undefined;
      const downButton = config.button as string | undefined;
      if (downTarget === "Coordinates") {
        return `Press ${downButton || "left"} button at (${config.x as number}, ${config.y as number})`;
      }
      return `Press ${downButton || "left"} button${downTarget ? ` at ${downTarget}` : ""}`;
    }
    case "MOUSE_UP": {
      const upTarget = config.target as string | undefined;
      const upButton = config.button as string | undefined;
      if (upTarget === "Coordinates") {
        return `Release ${upButton || "left"} button at (${config.x as number}, ${config.y as number})`;
      }
      return `Release ${upButton || "left"} button${upTarget ? ` at ${upTarget}` : ""}`;
    }
    case "KEY_PRESS": {
      const key = config.key as string | undefined;
      return key ? `Press key: ${key}` : "No key selected";
    }
    case "KEY_DOWN": {
      const keyDown = config.key as string | undefined;
      return keyDown ? `Hold key down: ${keyDown}` : "No key selected";
    }
    case "KEY_UP": {
      const keyUp = config.key as string | undefined;
      return keyUp ? `Release key: ${keyUp}` : "No key selected";
    }
    case "TYPE": {
      const textSource = config.textSource as string | undefined;
      if (textSource === "stateString") {
        const selectedState = config.selectedState as string | undefined;
        if (!selectedState) return "No state selected";
        const state = states.find((s) => s.id === selectedState);
        if (!state) return "Invalid state";

        const selectedStateStrings = config.selectedStateStrings as
          | string[]
          | undefined;
        if (
          selectedStateStrings &&
          selectedStateStrings.length > 0 &&
          state.strings
        ) {
          // Get the actual string values
          const selectedStrings = state.strings
            .filter((s) => selectedStateStrings.includes(s.id))
            .map((s) => s.value)
            .filter((v) => v); // Remove empty values

          if (selectedStrings.length === 0) {
            return `No strings selected from ${state.name || state.id}`;
          }

          // Join multiple strings with " | " and truncate if too long
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
        const text = config.text as string | undefined;
        if (!text) return "No text specified";
        // Truncate long text and show special keys
        const displayText =
          text.length > 30 ? text.substring(0, 30) + "..." : text;
        return `Type "${displayText.replace(/\n/g, "↵").replace(/\t/g, "→")}"`;
      }
    }
    case "DRAG": {
      const removedImageTo = config.removedImageTo as string | undefined;
      if (removedImageTo) {
        return `Drag from ${config.from as string} to [REMOVED: ${removedImageTo}]`;
      }
      return `Drag from ${config.from as string} to ${(config.to as string | undefined) || "target"}`;
    }
    case "SCROLL":
      return `Scroll ${config.direction as string} ${config.amount as number} units`;
    case "VANISH": {
      const removedImage = config.removedImage as string | undefined;
      if (removedImage) {
        return `Wait for [REMOVED: ${removedImage}] to vanish`;
      }
      // Handle new target structure
      const vanishTarget = config.target as
        | { type?: string; imageId?: string }
        | undefined;
      const vanishImageId =
        vanishTarget?.type === "image"
          ? vanishTarget.imageId
          : (config.image as string | undefined);
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
      // Support both old 'states' key and new 'stateIds' key for backward compatibility
      const targetStates =
        (config.stateIds as string[] | undefined) ||
        (config.states as string[] | undefined) ||
        [];
      if (targetStates.length > 0) {
        const stateNames = targetStates.map((stateId: string) => {
          const state = states.find((s) => s.id === stateId);
          return state ? state.name : stateId;
        });
        if (stateNames.length === 1) {
          return `Target: ${stateNames[0]}`;
        } else {
          return `Targets: ${stateNames.join(", ")} (${stateNames.length} states)`;
        }
      }
      return "No states selected";
    }
    case "RUN_WORKFLOW": {
      const processId = config.process as string | undefined;
      if (processId) {
        const proc = workflows.find((p) => p.id === processId);
        return proc ? proc.name : processId;
      }
      return "No process selected";
    }
    case "IF": {
      const thenActions = config.thenActions as unknown[] | undefined;
      const elseActions = config.elseActions as unknown[] | undefined;
      const condition = config.condition as { type?: string } | undefined;
      const thenCount = thenActions?.length || 0;
      const elseCount = elseActions?.length || 0;
      const conditionType = condition?.type || "not configured";
      if (elseCount > 0) {
        return `${conditionType} condition: ${thenCount} then-actions, ${elseCount} else-actions`;
      } else {
        return `${conditionType} condition: ${thenCount} then-actions`;
      }
    }
    case "LOOP": {
      const loopType = (config.loopType as string | undefined) || "FOR";
      const loopActions = config.actions as unknown[] | undefined;
      const actionCount = loopActions?.length || 0;
      if (loopType === "FOR") {
        const iterations = (config.iterations as number | undefined) || 0;
        return `FOR loop: ${iterations} iterations, ${actionCount} actions`;
      } else if (loopType === "WHILE") {
        return `WHILE loop: ${actionCount} actions`;
      } else {
        return `FOREACH loop: ${actionCount} actions`;
      }
    }
    default:
      return "Configure action";
  }
}
