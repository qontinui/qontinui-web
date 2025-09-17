"use client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Plus, GripVertical, Trash2, Copy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useAutomation } from "@/contexts/automation-context"

interface Process {
  id: string
  name: string
  description: string
  actions: Action[]
}

interface Action {
  id: string
  type: "FIND" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH" | "GO_TO_STATE" | "RUN_PROCESS"
  config: Record<string, any>
}

interface ActionEditorProps {
  process: Process
  selectedAction: Action | null
  onSelectAction: (action: Action) => void
  onUpdateProcess: (process: Process) => void
}

const ACTION_TYPES = [
  { type: "FIND", label: "Find Element", color: "bg-blue-500" },
  { type: "CLICK", label: "Click", color: "bg-green-500" },
  { type: "TYPE", label: "Type Text", color: "bg-yellow-500" },
  { type: "DRAG", label: "Drag & Drop", color: "bg-purple-500" },
  { type: "SCROLL", label: "Scroll", color: "bg-orange-500" },
  { type: "VANISH", label: "Wait for Vanish", color: "bg-red-500" },
  { type: "GO_TO_STATE", label: "Go to State", color: "bg-indigo-500" },
  { type: "RUN_PROCESS", label: "Run Process", color: "bg-pink-500" },
] as const

export function ActionEditor({ process, selectedAction, onSelectAction, onUpdateProcess }: ActionEditorProps) {
  const { states, processes } = useAutomation()

  const addAction = (type: Action["type"]) => {
    const newAction: Action = {
      id: `action-${Date.now()}`,
      type,
      config: getDefaultConfig(type),
    }

    const updatedProcess = {
      ...process,
      actions: [...process.actions, newAction],
    }

    onUpdateProcess(updatedProcess)
    onSelectAction(newAction)
  }

  const deleteAction = (actionId: string) => {
    const updatedProcess = {
      ...process,
      actions: process.actions.filter((a) => a.id !== actionId),
    }
    onUpdateProcess(updatedProcess)
    if (selectedAction?.id === actionId) {
      onSelectAction(process.actions[0] || null)
    }
  }

  const duplicateAction = (action: Action) => {
    const newAction: Action = {
      ...action,
      id: `action-${Date.now()}`,
    }

    const actionIndex = process.actions.findIndex((a) => a.id === action.id)
    const updatedActions = [...process.actions]
    updatedActions.splice(actionIndex + 1, 0, newAction)

    const updatedProcess = {
      ...process,
      actions: updatedActions,
    }

    onUpdateProcess(updatedProcess)
  }

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
            {ACTION_TYPES.map(({ type, label }) => (
              <DropdownMenuItem
                key={type}
                onClick={() => addAction(type)}
                className="hover:bg-gray-700 focus:bg-gray-700"
              >
                {label}
              </DropdownMenuItem>
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
            const actionType = ACTION_TYPES.find((t) => t.type === action.type)
            return (
              <Card
                key={action.id}
                className={`cursor-pointer transition-all hover:border-[#BD00FF]/50 ${
                  selectedAction?.id === action.id ? "border-[#BD00FF] bg-[#BD00FF]/10" : "border-gray-700 bg-[#27272A]"
                }`}
                onClick={() => onSelectAction(action)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-gray-500" />
                      <Badge className={`${actionType?.color} text-white text-xs`}>{index + 1}</Badge>
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
                      <p className="text-xs text-gray-400 mt-1">{getActionSummary(action, states, processes)}</p>
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

function getDefaultConfig(type: Action["type"]): Record<string, any> {
  switch (type) {
    case "FIND":
      return {
        image: null,
        similarity: 0.8,
        strategy: "First",
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    case "CLICK":
      return {
        target: "Last Find Result",
        clickType: "left",
        clickCount: 1,
        pause_before_begin: 0,
        pause_after_end: 0,
        hold_duration: 0,
      }
    case "TYPE":
      return {
        text: "",
        typing_delay: 50,
        clear_before: false,
        press_enter: false,
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    case "DRAG":
      return {
        from: "Last Find Result",
        to: null,
        drag_duration: 1000,
        smooth_movement: true,
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    case "SCROLL":
      return {
        direction: "down",
        amount: 3,
        scroll_duration: 500,
        smooth_scroll: true,
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    case "VANISH":
      return {
        image: null,
        timeout: 5000,
        check_interval: 500,
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    case "GO_TO_STATE":
      return {
        state: null,
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    case "RUN_PROCESS":
      return {
        process: null,
        pause_before_begin: 0,
        pause_after_end: 0,
      }
    default:
      return {}
  }
}

function getActionSummary(action: Action, states: any[], processes: any[]): string {
  switch (action.type) {
    case "FIND":
      return action.config.image ? `Find ${action.config.image}` : "No image selected"
    case "CLICK":
      return `${action.config.clickType} click on ${action.config.target}`
    case "TYPE":
      if (!action.config.text) return "No text specified"
      // Truncate long text and show special keys
      const displayText = action.config.text.length > 30 
        ? action.config.text.substring(0, 30) + "..." 
        : action.config.text
      return `Type "${displayText.replace(/\n/g, '↵').replace(/\t/g, '→')}"`
    case "DRAG":
      return `Drag from ${action.config.from} to ${action.config.to || "target"}`
    case "SCROLL":
      return `Scroll ${action.config.direction} ${action.config.amount} units`
    case "VANISH":
      return action.config.image ? `Wait for ${action.config.image} to vanish` : "No image selected"
    case "GO_TO_STATE":
      if (action.config.state) {
        const state = states.find(s => s.id === action.config.state)
        return state ? `Target: ${state.name}` : `Target: ${action.config.state}`
      }
      return "No state selected"
    case "RUN_PROCESS":
      if (action.config.process) {
        const proc = processes.find(p => p.id === action.config.process)
        return proc ? proc.name : action.config.process
      }
      return "No process selected"
    default:
      return "Configure action"
  }
}
