/**
 * SequentialEditor Component
 *
 * Timeline-based action editor for sequential processes.
 * Extracted from ActionEditor to be reusable with both Process and Workflow formats.
 */

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import { Plus, GripVertical, Trash2, Copy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useAutomation } from "@/contexts/automation-context"
import type { SequentialEditorProps } from "../types"
import type { Action } from "@/lib/action-schema/action-types"

const ACTION_GROUPS = {
  Find: [
    { type: "FIND", label: "Find Element", color: "bg-blue-500" },
    { type: "FIND_STATE_IMAGE", label: "Find State Image", color: "bg-cyan-500" },
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
    { type: "RUN_PROCESS", label: "Run Process", color: "bg-pink-500" },
  ],
  Verification: [
    { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  ],
} as const

// Flat list for finding action types by type
const ACTION_TYPES = Object.values(ACTION_GROUPS).flat()

export function SequentialEditor({
  actions,
  selectedAction,
  onSelectAction,
  onUpdateActions,
}: SequentialEditorProps) {
  const { states, workflows, images } = useAutomation()
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  const addAction = (type: Action["type"]) => {
    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config: getDefaultConfig(type),
      position: [100, 100 + actions.length * 150], // Auto-position vertically
    }

    onUpdateActions([...actions, newAction])
    onSelectAction(newAction)
  }

  const deleteAction = (actionId: string) => {
    const updatedActions = actions.filter((a) => a.id !== actionId)
    onUpdateActions(updatedActions)

    if (selectedAction?.id === actionId) {
      onSelectAction(updatedActions[0] || null)
    }
  }

  const duplicateAction = (action: Action) => {
    const newAction: Action = {
      ...action,
      id: `action-${Date.now()}`,
    }

    const actionIndex = actions.findIndex((a) => a.id === action.id)
    const updatedActions = [...actions]
    updatedActions.splice(actionIndex + 1, 0, newAction)

    onUpdateActions(updatedActions)
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()

    if (draggedIndex === null || draggedIndex === index) return

    const updatedActions = [...actions]
    const draggedAction = updatedActions[draggedIndex]

    // Remove from old position
    updatedActions.splice(draggedIndex, 1)
    // Insert at new position
    updatedActions.splice(index, 0, draggedAction)

    onUpdateActions(updatedActions)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  return (
    <div className="space-y-4 p-6">
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

      <div className="space-y-2">
        {actions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
            <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No actions yet</p>
            <p className="text-sm">Add an action to get started</p>
          </div>
        ) : (
          actions.map((action, index) => {
            const actionType = ACTION_TYPES.find((t) => t.type === action.type)
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
                      <Badge className={`${actionType?.color} text-white text-xs`}>
                        {index + 1}
                      </Badge>
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{actionType?.label}</span>
                        {action.type !== "GO_TO_STATE" && action.type !== "RUN_PROCESS" && (
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
                          e.stopPropagation()
                          duplicateAction(action)
                        }}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteAction(action.id)
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}

// Helper functions (copied from action-editor.tsx)
function getDefaultConfig(type: Action["type"]): Record<string, any> {
  switch (type) {
    case "FIND":
      return { image: null }
    case "FIND_STATE_IMAGE":
      return { state: null }
    case "CLICK":
      return { target: "Last Find Result", clickType: "left", clickCount: 1, hold_duration: 0 }
    case "TYPE":
      return {
        text: "",
        textSource: "stateString",
        selectedState: null,
        selectedStateStrings: [],
        typing_delay: 50,
        clear_before: false,
        press_enter: false,
      }
    case "DRAG":
      return { from: "Last Find Result", to: null, drag_duration: 1000, smooth_movement: true }
    case "SCROLL":
      return { direction: "down", amount: 3, scroll_duration: 500, smooth_scroll: true }
    case "VANISH":
      return { image: null, timeout: 5000, check_interval: 500 }
    case "GO_TO_STATE":
      return { state: null }
    case "RUN_PROCESS":
      return { process: null }
    case "IF":
      return {
        condition: { type: "variable", variableName: "", operator: "==", expectedValue: "" },
        thenActions: [],
      }
    case "LOOP":
      return { loopType: "FOR", iterations: 10, actions: [], maxIterations: 1000, breakOnError: false }
    case "MOUSE_MOVE":
      return { target: "Last Find Result", x: 0, y: 0, duration: 0 }
    case "MOUSE_DOWN":
      return { button: "left", target: null }
    case "MOUSE_UP":
      return { button: "left", target: null }
    case "DOUBLE_CLICK":
      return { target: "Last Find Result", clickType: "left" }
    case "RIGHT_CLICK":
      return { target: "Last Find Result" }
    case "KEY_PRESS":
      return { key: "" }
    case "KEY_DOWN":
      return { key: "" }
    case "KEY_UP":
      return { key: "" }
    default:
      return {}
  }
}

function renderActionSummary(action: Action, states: any[], workflows: any[], images: any[]) {
  const summary = getActionSummary(action, states, workflows, images)
  const hasRemovedImage = summary.includes("[REMOVED:")

  if (hasRemovedImage) {
    const parts = summary.split(/(\[REMOVED:[^\]]+\])/)
    return (
      <p className="text-xs mt-1">
        {parts.map((part, index) => {
          if (part.startsWith("[REMOVED:")) {
            return (
              <span key={index} className="text-red-400 font-medium">
                {part}
              </span>
            )
          }
          return (
            <span key={index} className="text-gray-400">
              {part}
            </span>
          )
        })}
      </p>
    )
  }

  return <p className="text-xs text-gray-400 mt-1">{summary}</p>
}

function getActionSummary(action: Action, states: any[], workflows: any[], images: any[]): string {
  switch (action.type) {
    case "FIND":
      if (action.config.removedImage) {
        return `[REMOVED: ${action.config.removedImage}]`
      }
      if (action.config.image) {
        let stateImageName = null
        for (const state of states) {
          const stateImage = state.stateImages?.find((si: any) => si.id === action.config.image)
          if (stateImage) {
            stateImageName = stateImage.name
            break
          }
        }
        if (stateImageName) {
          const nameWithoutExtension = stateImageName.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, "")
          return `Find ${nameWithoutExtension}`
        }
        const image = images.find((img) => img.id === action.config.image)
        if (image) {
          const nameWithoutExtension = image.name.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, "")
          return `Find ${nameWithoutExtension}`
        }
        return "Image not found"
      }
      return "No image selected"
    case "FIND_STATE_IMAGE":
      if (action.config.state) {
        const state = states.find((s) => s.id === action.config.state)
        return state ? `Find any image from ${state.name}` : "State not found"
      }
      return "No state selected"
    case "CLICK":
      return `${action.config.clickType} click on ${action.config.target}`
    case "DOUBLE_CLICK":
      return `Double click on ${action.config.target || "Last Find Result"}`
    case "RIGHT_CLICK":
      return `Right click on ${action.config.target || "Last Find Result"}`
    case "TYPE":
      if (action.config.textSource === "stateString") {
        if (!action.config.selectedState) return "No state selected"
        const state = states.find((s) => s.id === action.config.selectedState)
        if (!state) return "Invalid state"
        if (action.config.selectedStateStrings?.length > 0 && state.strings) {
          const selectedStrings = state.strings
            .filter((s: any) => action.config.selectedStateStrings.includes(s.id))
            .map((s: any) => s.value)
            .filter((v: any) => v)
          if (selectedStrings.length === 0) {
            return `No strings selected from ${state.name || state.id}`
          }
          const combinedText = selectedStrings.join(" | ")
          const displayText =
            combinedText.length > 40 ? combinedText.substring(0, 40) + "..." : combinedText
          return `Type "${displayText.replace(/\n/g, "↵").replace(/\t/g, "→")}" (${state.name || state.id})`
        } else {
          return `No strings selected from ${state.name || state.id}`
        }
      } else {
        if (!action.config.text) return "No text specified"
        const displayText =
          action.config.text.length > 30 ? action.config.text.substring(0, 30) + "..." : action.config.text
        return `Type "${displayText.replace(/\n/g, "↵").replace(/\t/g, "→")}"`
      }
    case "DRAG":
      if (action.config.removedImageTo) {
        return `Drag from ${action.config.from} to [REMOVED: ${action.config.removedImageTo}]`
      }
      return `Drag from ${action.config.from} to ${action.config.to || "target"}`
    case "SCROLL":
      return `Scroll ${action.config.direction} ${action.config.amount} units`
    case "VANISH":
      if (action.config.removedImage) {
        return `Wait for [REMOVED: ${action.config.removedImage}] to vanish`
      }
      return action.config.image ? `Wait for ${action.config.image} to vanish` : "No image selected"
    case "GO_TO_STATE":
      if (action.config.state) {
        const state = states.find((s) => s.id === action.config.state)
        return state ? `Target: ${state.name}` : `Target: ${action.config.state}`
      }
      return "No state selected"
    case "RUN_PROCESS":
      if (action.config.process) {
        const workflow = workflows.find((w: any) => w.id === action.config.process)
        return workflow ? workflow.name : action.config.process
      }
      return "No workflow selected"
    case "IF":
      const thenCount = action.config.thenActions?.length || 0
      const elseCount = action.config.elseActions?.length || 0
      const conditionType = action.config.condition?.type || "not configured"
      if (elseCount > 0) {
        return `${conditionType} condition: ${thenCount} then-actions, ${elseCount} else-actions`
      } else {
        return `${conditionType} condition: ${thenCount} then-actions`
      }
    case "LOOP":
      const loopType = action.config.loopType || "FOR"
      const actionCount = action.config.actions?.length || 0
      if (loopType === "FOR") {
        const iterations = action.config.iterations || 0
        return `FOR loop: ${iterations} iterations, ${actionCount} actions`
      } else if (loopType === "WHILE") {
        return `WHILE loop: ${actionCount} actions`
      } else {
        return `FOREACH loop: ${actionCount} actions`
      }
    case "MOUSE_MOVE":
      if (action.config.target === "Coordinates") {
        return `Move mouse to (${action.config.x}, ${action.config.y})`
      }
      return `Move mouse to ${action.config.target}`
    case "MOUSE_DOWN":
      if (action.config.target === "Coordinates") {
        return `Press ${action.config.button || "left"} button at (${action.config.x}, ${action.config.y})`
      }
      return `Press ${action.config.button || "left"} button${action.config.target ? ` at ${action.config.target}` : ""}`
    case "MOUSE_UP":
      if (action.config.target === "Coordinates") {
        return `Release ${action.config.button || "left"} button at (${action.config.x}, ${action.config.y})`
      }
      return `Release ${action.config.button || "left"} button${action.config.target ? ` at ${action.config.target}` : ""}`
    case "KEY_PRESS":
      return action.config.key ? `Press key: ${action.config.key}` : "No key selected"
    case "KEY_DOWN":
      return action.config.key ? `Hold key down: ${action.config.key}` : "No key selected"
    case "KEY_UP":
      return action.config.key ? `Release key: ${action.config.key}` : "No key selected"
    default:
      return "Configure action"
  }
}
