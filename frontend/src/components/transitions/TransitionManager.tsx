"use client"

import React, { useState, useMemo, useCallback } from "react"
import { useAutomation } from "@/contexts/automation-context"
import {
  OutgoingTransition,
  IncomingTransition,
  Transition,
  State,
} from "@/contexts/automation-context/types"
import { Workflow } from "@/lib/action-schema/action-types"
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Search,
  Filter,
  Download,
  Upload,
  Trash2,
  Copy,
  Edit,
  Play,
  Plus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Settings,
  Grid3x3,
  List,
  Network,
  BarChart3,
  Layers,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Save,
  X,
  GitBranch,
  Clock,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

// ============================================================================
// Types and Interfaces
// ============================================================================

type ViewMode = "matrix" | "list" | "graph" | "statistics"

interface TransitionFilters {
  searchQuery: string
  fromState: string
  toState: string
  actionType: "all" | "with_workflow" | "without_workflow"
  hasWorkflow: string
  showCircular: boolean
  showBroken: boolean
}

interface TransitionValidation {
  circular: string[]
  brokenStateReferences: string[]
  missingWorkflows: string[]
  unreachableStates: string[]
  deadEndStates: string[]
}

interface TransitionTemplate {
  id: string
  name: string
  description: string
  type: "outgoing" | "incoming"
  config: Partial<Transition>
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FILTERS: TransitionFilters = {
  searchQuery: "",
  fromState: "all",
  toState: "all",
  actionType: "all",
  hasWorkflow: "all",
  showCircular: false,
  showBroken: false,
}

const BUILT_IN_TEMPLATES: TransitionTemplate[] = [
  {
    id: "template-1",
    name: "Basic Navigation",
    description: "Simple state-to-state navigation without workflows",
    type: "outgoing",
    config: {
      timeout: 5000,
      retryCount: 0,
      workflows: [],
    },
  },
  {
    id: "template-2",
    name: "Navigation with Action",
    description: "Navigation with a single workflow execution",
    type: "outgoing",
    config: {
      timeout: 10000,
      retryCount: 1,
      workflows: [],
    },
  },
  {
    id: "template-3",
    name: "Entry Setup",
    description: "Incoming transition for state initialization",
    type: "incoming",
    config: {
      timeout: 8000,
      retryCount: 0,
      workflows: [],
    },
  },
]

const COLORS = {
  primary: "#00D9FF",
  success: "#00FF88",
  warning: "#FFB800",
  danger: "#FF4444",
  purple: "#BD00FF",
  gray: "#666666",
}

// ============================================================================
// Utility Functions
// ============================================================================

function analyzeTransitions(
  transitions: Transition[],
  states: State[]
): TransitionValidation {
  const validation: TransitionValidation = {
    circular: [],
    brokenStateReferences: [],
    missingWorkflows: [],
    unreachableStates: [],
    deadEndStates: [],
  }

  const stateIds = new Set(states.map((s) => s.id))

  // Check for broken state references
  transitions.forEach((t) => {
    if (t.type === "OutgoingTransition") {
      if (!stateIds.has(t.fromState)) {
        validation.brokenStateReferences.push(t.id)
      }
      t.activateStates.forEach((stateId) => {
        if (!stateIds.has(stateId)) {
          validation.brokenStateReferences.push(t.id)
        }
      })
    } else if (t.type === "IncomingTransition") {
      if (!stateIds.has(t.toState)) {
        validation.brokenStateReferences.push(t.id)
      }
    }
  })

  // Detect circular transitions (simplified)
  const outgoingTransitions = transitions.filter(
    (t): t is OutgoingTransition => t.type === "OutgoingTransition"
  )

  outgoingTransitions.forEach((t) => {
    t.activateStates.forEach((targetState) => {
      const reverseTransition = outgoingTransitions.find(
        (ot) =>
          ot.fromState === targetState && ot.activateStates.includes(t.fromState)
      )
      if (reverseTransition) {
        if (!validation.circular.includes(t.id)) {
          validation.circular.push(t.id)
        }
      }
    })
  })

  // Find unreachable states (states with no incoming transitions)
  const reachableStates = new Set<string>()
  outgoingTransitions.forEach((t) => {
    t.activateStates.forEach((stateId) => reachableStates.add(stateId))
  })

  states.forEach((state) => {
    if (!state.initial && !reachableStates.has(state.id)) {
      validation.unreachableStates.push(state.id)
    }
  })

  // Find dead-end states (states with no outgoing transitions)
  const statesWithOutgoing = new Set(outgoingTransitions.map((t) => t.fromState))
  states.forEach((state) => {
    if (!statesWithOutgoing.has(state.id)) {
      validation.deadEndStates.push(state.id)
    }
  })

  return validation
}

function getTransitionCellColor(
  fromState: string,
  toState: string,
  transitions: OutgoingTransition[],
  validation: TransitionValidation
): { color: string; count: number } {
  const matchingTransitions = transitions.filter(
    (t) => t.fromState === fromState && t.activateStates.includes(toState)
  )

  if (matchingTransitions.length === 0) {
    return { color: COLORS.gray, count: 0 }
  }

  // Check if any matching transition is circular
  const hasCircular = matchingTransitions.some((t) =>
    validation.circular.includes(t.id)
  )
  if (hasCircular) {
    return { color: COLORS.danger, count: matchingTransitions.length }
  }

  if (matchingTransitions.length > 1) {
    return { color: COLORS.warning, count: matchingTransitions.length }
  }

  return { color: COLORS.success, count: matchingTransitions.length }
}

// ============================================================================
// Sub-Components
// ============================================================================

// Transition Matrix View
function TransitionMatrix({
  transitions,
  states,
  validation,
  onTransitionClick,
}: {
  transitions: Transition[]
  states: State[]
  validation: TransitionValidation
  onTransitionClick: (fromState: string, toState: string) => void
}) {
  const outgoingTransitions = transitions.filter(
    (t): t is OutgoingTransition => t.type === "OutgoingTransition"
  )

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-[#27272A] border border-gray-700 p-2 text-xs font-medium text-gray-400">
              From \ To
            </th>
            {states.map((state) => (
              <th
                key={state.id}
                className="sticky top-0 z-10 bg-[#27272A] border border-gray-700 p-2 text-xs font-medium text-gray-400 min-w-[100px]"
              >
                <div className="truncate" title={state.name}>
                  {state.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {states.map((fromState) => (
            <tr key={fromState.id}>
              <td className="sticky left-0 z-10 bg-[#27272A] border border-gray-700 p-2 text-xs font-medium">
                <div className="truncate" title={fromState.name}>
                  {fromState.name}
                </div>
              </td>
              {states.map((toState) => {
                const { color, count } = getTransitionCellColor(
                  fromState.id,
                  toState.id,
                  outgoingTransitions,
                  validation
                )
                return (
                  <td
                    key={toState.id}
                    className="border border-gray-700 p-0 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => onTransitionClick(fromState.id, toState.id)}
                  >
                    <div
                      className="h-12 flex items-center justify-center"
                      style={{ backgroundColor: `${color}20` }}
                    >
                      {count > 0 && (
                        <Badge
                          className="text-xs"
                          style={{ backgroundColor: color, color: "black" }}
                        >
                          {count}
                        </Badge>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Transition List View
function TransitionList({
  transitions,
  states,
  workflows,
  validation,
  filters,
  selectedTransitions,
  onTransitionSelect,
  onTransitionClick,
  onTransitionDelete,
}: {
  transitions: Transition[]
  states: State[]
  workflows: Workflow[]
  validation: TransitionValidation
  filters: TransitionFilters
  selectedTransitions: Set<string>
  onTransitionSelect: (id: string, selected: boolean) => void
  onTransitionClick: (transition: Transition) => void
  onTransitionDelete: (id: string) => void
}) {
  const [sortBy, setSortBy] = useState<"fromState" | "toState" | "type" | "modified">(
    "fromState"
  )
  const [groupBy, setGroupBy] = useState<
    "none" | "fromState" | "toState" | "type"
  >("none")

  const filteredTransitions = useMemo(() => {
    return transitions.filter((t) => {
      // Search query
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        const fromStateName =
          t.type === "OutgoingTransition"
            ? states.find((s) => s.id === t.fromState)?.name.toLowerCase()
            : ""
        const toStateName =
          t.type === "IncomingTransition"
            ? states.find((s) => s.id === t.toState)?.name.toLowerCase()
            : t.type === "OutgoingTransition"
            ? t.activateStates
                .map((id) => states.find((s) => s.id === id)?.name.toLowerCase())
                .join(" ")
            : ""

        if (
          !fromStateName?.includes(query) &&
          !toStateName?.includes(query)
        ) {
          return false
        }
      }

      // From state filter
      if (
        filters.fromState !== "all" &&
        t.type === "OutgoingTransition" &&
        t.fromState !== filters.fromState
      ) {
        return false
      }

      // To state filter
      if (filters.toState !== "all") {
        if (t.type === "IncomingTransition" && t.toState !== filters.toState) {
          return false
        }
        if (
          t.type === "OutgoingTransition" &&
          !t.activateStates.includes(filters.toState)
        ) {
          return false
        }
      }

      // Action type filter
      if (filters.actionType === "with_workflow" && t.workflows.length === 0) {
        return false
      }
      if (
        filters.actionType === "without_workflow" &&
        t.workflows.length > 0
      ) {
        return false
      }

      // Has workflow filter
      if (
        filters.hasWorkflow !== "all" &&
        !t.workflows.includes(filters.hasWorkflow)
      ) {
        return false
      }

      // Show circular filter
      if (filters.showCircular && !validation.circular.includes(t.id)) {
        return false
      }

      // Show broken filter
      if (
        filters.showBroken &&
        !validation.brokenStateReferences.includes(t.id)
      ) {
        return false
      }

      return true
    })
  }, [transitions, filters, states, validation])

  const sortedTransitions = useMemo(() => {
    return [...filteredTransitions].sort((a, b) => {
      if (sortBy === "fromState" && a.type === "OutgoingTransition" && b.type === "OutgoingTransition") {
        const aState = states.find((s) => s.id === a.fromState)?.name || ""
        const bState = states.find((s) => s.id === b.fromState)?.name || ""
        return aState.localeCompare(bState)
      }
      if (sortBy === "toState") {
        const aState =
          a.type === "IncomingTransition"
            ? states.find((s) => s.id === a.toState)?.name || ""
            : ""
        const bState =
          b.type === "IncomingTransition"
            ? states.find((s) => s.id === b.toState)?.name || ""
            : ""
        return aState.localeCompare(bState)
      }
      if (sortBy === "type") {
        return a.type.localeCompare(b.type)
      }
      return 0
    })
  }, [filteredTransitions, sortBy, states])

  const groupedTransitions = useMemo(() => {
    if (groupBy === "none") {
      return { "": sortedTransitions }
    }

    const groups: Record<string, Transition[]> = {}

    sortedTransitions.forEach((t) => {
      let groupKey = ""

      if (groupBy === "fromState" && t.type === "OutgoingTransition") {
        groupKey = states.find((s) => s.id === t.fromState)?.name || "Unknown"
      } else if (groupBy === "toState" && t.type === "IncomingTransition") {
        groupKey = states.find((s) => s.id === t.toState)?.name || "Unknown"
      } else if (groupBy === "type") {
        groupKey = t.type
      } else {
        groupKey = "Other"
      }

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(t)
    })

    return groups
  }, [sortedTransitions, groupBy, states])

  const getTransitionIcon = (transition: Transition) => {
    if (validation.circular.includes(transition.id)) {
      return <RefreshCw className="w-4 h-4 text-red-400" />
    }
    if (validation.brokenStateReferences.includes(transition.id)) {
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />
    }
    if (transition.workflows.length > 0) {
      return <Zap className="w-4 h-4 text-[#00D9FF]" />
    }
    return <ArrowRight className="w-4 h-4 text-gray-400" />
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Sort and Group Controls */}
      <div className="flex gap-2">
        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="w-[150px] bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fromState">Sort by From</SelectItem>
            <SelectItem value="toState">Sort by To</SelectItem>
            <SelectItem value="type">Sort by Type</SelectItem>
            <SelectItem value="modified">Sort by Modified</SelectItem>
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
          <SelectTrigger className="w-[150px] bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="fromState">Group by From</SelectItem>
            <SelectItem value="toState">Group by To</SelectItem>
            <SelectItem value="type">Group by Type</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Transition List */}
      <ScrollArea className="flex-1">
        <div className="space-y-4">
          {Object.entries(groupedTransitions).map(([groupName, groupTransitions]) => (
            <div key={groupName}>
              {groupBy !== "none" && (
                <div className="flex items-center gap-2 mb-2">
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-300">
                    {groupName} ({groupTransitions.length})
                  </span>
                </div>
              )}
              <div className="space-y-2">
                {groupTransitions.map((transition) => (
                  <Card
                    key={transition.id}
                    className="border-gray-700 bg-[#27272A] hover:border-[#00D9FF] transition-colors cursor-pointer"
                    onClick={() => onTransitionClick(transition)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedTransitions.has(transition.id)}
                          onCheckedChange={(checked) =>
                            onTransitionSelect(transition.id, !!checked)
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                        {getTransitionIcon(transition)}
                        <div className="flex-1 min-w-0">
                          {transition.type === "OutgoingTransition" ? (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium truncate">
                                {states.find((s) => s.id === transition.fromState)
                                  ?.name || "Unknown"}
                              </span>
                              <ArrowRight className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">
                                {transition.activateStates
                                  .map(
                                    (id) =>
                                      states.find((s) => s.id === id)?.name ||
                                      "Unknown"
                                  )
                                  .join(", ")}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-gray-400">Entry:</span>
                              <span className="font-medium">
                                {states.find((s) => s.id === transition.toState)
                                  ?.name || "Unknown"}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{
                                borderColor:
                                  transition.type === "OutgoingTransition"
                                    ? COLORS.success
                                    : COLORS.primary,
                              }}
                            >
                              {transition.type === "OutgoingTransition"
                                ? "Outgoing"
                                : "Incoming"}
                            </Badge>
                            {transition.workflows.length > 0 && (
                              <Badge className="text-xs bg-[#00D9FF]/20 text-[#00D9FF]">
                                {transition.workflows.length} workflow
                                {transition.workflows.length !== 1 ? "s" : ""}
                              </Badge>
                            )}
                            {transition.timeout && (
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {transition.timeout}ms
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                          onClick={(e) => {
                            e.stopPropagation()
                            onTransitionDelete(transition.id)
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// Transition Editor Panel
function TransitionEditor({
  transition,
  states,
  workflows,
  onUpdate,
  onDelete,
  onClose,
}: {
  transition: Transition | null
  states: State[]
  workflows: Workflow[]
  onUpdate: (updates: Partial<Transition>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [localTransition, setLocalTransition] = useState(transition)

  React.useEffect(() => {
    setLocalTransition(transition)
  }, [transition])

  if (!localTransition) {
    return (
      <Card className="border-gray-700 bg-[#27272A] h-full">
        <CardContent className="flex items-center justify-center h-full">
          <div className="text-center text-gray-400">
            <Edit className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Select a transition to edit</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const handleSave = () => {
    onUpdate(localTransition)
    toast.success("Transition updated")
  }

  return (
    <Card className="border-gray-700 bg-[#27272A] h-full flex flex-col">
      <CardHeader className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-[#00D9FF]">
            Transition Editor
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto space-y-4">
        {/* Basic Info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-400">Type</Label>
            <Badge
              variant="outline"
              style={{
                borderColor:
                  localTransition.type === "OutgoingTransition"
                    ? COLORS.success
                    : COLORS.primary,
              }}
            >
              {localTransition.type === "OutgoingTransition"
                ? "Outgoing"
                : "Incoming"}
            </Badge>
          </div>

          {localTransition.type === "OutgoingTransition" && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">From State</Label>
                <Select
                  value={localTransition.fromState}
                  onValueChange={(value) =>
                    setLocalTransition({ ...localTransition, fromState: value })
                  }
                >
                  <SelectTrigger className="bg-transparent border-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={localTransition.staysVisible}
                  onCheckedChange={(checked) =>
                    setLocalTransition({
                      ...localTransition,
                      staysVisible: !!checked,
                    })
                  }
                />
                <Label className="text-xs">Origin state stays visible</Label>
              </div>
            </>
          )}

          {localTransition.type === "IncomingTransition" && (
            <div className="space-y-2">
              <Label className="text-xs">To State</Label>
              <Select
                value={localTransition.toState}
                onValueChange={(value) =>
                  setLocalTransition({ ...localTransition, toState: value })
                }
              >
                <SelectTrigger className="bg-transparent border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {states.map((state) => (
                    <SelectItem key={state.id} value={state.id}>
                      {state.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Separator className="bg-gray-700" />

        {/* Configuration */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Configuration</Label>

          <div className="space-y-2">
            <Label className="text-xs">Timeout (ms)</Label>
            <Input
              type="number"
              value={localTransition.timeout || 0}
              onChange={(e) =>
                setLocalTransition({
                  ...localTransition,
                  timeout: parseInt(e.target.value) || 0,
                })
              }
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Retry Count</Label>
            <Input
              type="number"
              value={localTransition.retryCount || 0}
              onChange={(e) =>
                setLocalTransition({
                  ...localTransition,
                  retryCount: parseInt(e.target.value) || 0,
                })
              }
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Workflows</Label>
            <div className="space-y-1">
              {localTransition.workflows.map((workflowId, index) => {
                const workflow = workflows.find((w) => w.id === workflowId)
                return (
                  <div
                    key={workflowId}
                    className="flex items-center justify-between p-2 bg-gray-800 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className="text-xs">{index + 1}</Badge>
                      <span className="text-sm">
                        {workflow?.name || "Unknown"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-400"
                      onClick={() =>
                        setLocalTransition({
                          ...localTransition,
                          workflows: localTransition.workflows.filter(
                            (id) => id !== workflowId
                          ),
                        })
                      }
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )
              })}
              <Select
                value=""
                onValueChange={(value) =>
                  setLocalTransition({
                    ...localTransition,
                    workflows: [...localTransition.workflows, value],
                  })
                }
              >
                <SelectTrigger className="bg-transparent border-gray-700">
                  <SelectValue placeholder="Add workflow..." />
                </SelectTrigger>
                <SelectContent>
                  {workflows
                    .filter((w) => !localTransition.workflows.includes(w.id))
                    .map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>

      <CardContent className="flex-shrink-0 pt-0">
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            className="flex-1 bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
          >
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
          <Button
            variant="outline"
            onClick={onDelete}
            className="border-red-400 text-red-400 hover:bg-red-400/20"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// Transition Graph Visualization
function TransitionGraph({
  transitions,
  states,
  onTransitionClick,
}: {
  transitions: Transition[]
  states: State[]
  onTransitionClick: (transition: Transition) => void
}) {
  const [nodes, setNodes] = useNodesState([])
  const [edges, setEdges] = useEdgesState([])

  React.useEffect(() => {
    // Create nodes from states
    const newNodes: Node[] = states.map((state, index) => ({
      id: state.id,
      type: "default",
      position: {
        x: (index % 5) * 200,
        y: Math.floor(index / 5) * 150,
      },
      data: {
        label: state.name,
      },
      style: {
        background: state.initial ? COLORS.primary : "#27272A",
        border: `2px solid ${state.initial ? COLORS.primary : "#666"}`,
        color: "white",
        borderRadius: "8px",
        padding: "10px",
      },
    }))

    // Create edges from transitions
    const newEdges: Edge[] = []
    transitions.forEach((transition) => {
      if (transition.type === "OutgoingTransition") {
        transition.activateStates.forEach((toStateId) => {
          newEdges.push({
            id: `${transition.fromState}-${toStateId}-${transition.id}`,
            source: transition.fromState,
            target: toStateId,
            type: "smoothstep",
            animated: transition.workflows.length > 0,
            style: {
              stroke: transition.workflows.length > 0 ? COLORS.primary : COLORS.gray,
              strokeWidth: 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: transition.workflows.length > 0 ? COLORS.primary : COLORS.gray,
            },
            data: { transition },
          })
        })
      }
    })

    setNodes(newNodes)
    setEdges(newEdges)
  }, [transitions, states, setNodes, setEdges])

  return (
    <div className="h-full w-full bg-[#1A1A1B] rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="#333" gap={16} />
        <Controls className="bg-[#27272A] border-gray-700" />
        <MiniMap
          className="bg-[#27272A] border border-gray-700"
          nodeColor={(node) => {
            const state = states.find((s) => s.id === node.id)
            return state?.initial ? COLORS.primary : "#666"
          }}
        />
      </ReactFlow>
    </div>
  )
}

// Statistics Dashboard
function StatisticsDashboard({
  transitions,
  states,
  validation,
}: {
  transitions: Transition[]
  states: State[]
  validation: TransitionValidation
}) {
  const stats = useMemo(() => {
    const outgoing = transitions.filter(
      (t): t is OutgoingTransition => t.type === "OutgoingTransition"
    )
    const incoming = transitions.filter(
      (t): t is IncomingTransition => t.type === "IncomingTransition"
    )

    // Count transitions per state
    const transitionsPerState = new Map<string, number>()
    outgoing.forEach((t) => {
      transitionsPerState.set(
        t.fromState,
        (transitionsPerState.get(t.fromState) || 0) + 1
      )
    })

    const avgTransitions =
      transitionsPerState.size > 0
        ? Array.from(transitionsPerState.values()).reduce((a, b) => a + b, 0) /
          transitionsPerState.size
        : 0

    // Most connected states
    const sortedStates = Array.from(transitionsPerState.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([stateId, count]) => ({
        name: states.find((s) => s.id === stateId)?.name || "Unknown",
        count,
      }))

    // Coverage
    const statesWithTransitions = new Set([
      ...outgoing.map((t) => t.fromState),
      ...incoming.map((t) => t.toState),
    ])
    const coverage = states.length > 0
      ? (statesWithTransitions.size / states.length) * 100
      : 0

    return {
      total: transitions.length,
      outgoing: outgoing.length,
      incoming: incoming.length,
      avgTransitions: avgTransitions.toFixed(1),
      mostConnected: sortedStates,
      coverage: coverage.toFixed(1),
      orphaned: validation.unreachableStates.length,
      circular: validation.circular.length,
      deadEnd: validation.deadEndStates.length,
    }
  }, [transitions, states, validation])

  const pieData = [
    { name: "Outgoing", value: stats.outgoing, color: COLORS.success },
    { name: "Incoming", value: stats.incoming, color: COLORS.primary },
  ]

  return (
    <div className="h-full overflow-y-auto space-y-4 p-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">
              Total Transitions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00D9FF]">
              {stats.total}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">
              Avg per State
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00FF88]">
              {stats.avgTransitions}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#BD00FF]">
              {stats.coverage}%
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#FF4444]">
              {stats.circular + stats.orphaned + stats.deadEnd}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader>
            <CardTitle className="text-sm">Transition Types</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#27272A",
                    border: "1px solid #666",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader>
            <CardTitle className="text-sm">Most Connected States</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.mostConnected}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="name"
                  stroke="#666"
                  style={{ fontSize: "12px" }}
                />
                <YAxis stroke="#666" style={{ fontSize: "12px" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#27272A",
                    border: "1px solid #666",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="count" fill={COLORS.primary} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Validation Panel
function ValidationPanel({
  validation,
  states,
  transitions,
  onIssueClick,
}: {
  validation: TransitionValidation
  states: State[]
  transitions: Transition[]
  onIssueClick: (issueType: string, itemId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(true)

  const totalIssues =
    validation.circular.length +
    validation.brokenStateReferences.length +
    validation.missingWorkflows.length +
    validation.unreachableStates.length +
    validation.deadEndStates.length

  if (totalIssues === 0) {
    return null
  }

  return (
    <Card className="border-gray-700 bg-[#27272A]">
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <CardTitle className="text-sm">
              Validation Issues ({totalIssues})
            </CardTitle>
          </div>
          {isOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="space-y-3">
          {validation.circular.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-red-400">
                <RefreshCw className="w-3 h-3" />
                <span>Circular Transitions ({validation.circular.length})</span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.circular.map((id) => {
                  const transition = transitions.find((t) => t.id === id)
                  return (
                    <button
                      key={id}
                      className="text-xs text-gray-400 hover:text-white block w-full text-left"
                      onClick={() => onIssueClick("circular", id)}
                    >
                      {transition?.type === "OutgoingTransition"
                        ? `${
                            states.find((s) => s.id === transition.fromState)
                              ?.name
                          } → ${transition.activateStates
                            .map(
                              (sid) => states.find((s) => s.id === sid)?.name
                            )
                            .join(", ")}`
                        : "Unknown transition"}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {validation.brokenStateReferences.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-yellow-400">
                <AlertTriangle className="w-3 h-3" />
                <span>
                  Broken References ({validation.brokenStateReferences.length})
                </span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.brokenStateReferences.map((id) => (
                  <button
                    key={id}
                    className="text-xs text-gray-400 hover:text-white block"
                    onClick={() => onIssueClick("broken", id)}
                  >
                    Transition {id.slice(0, 8)}...
                  </button>
                ))}
              </div>
            </div>
          )}

          {validation.unreachableStates.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-orange-400">
                <XCircle className="w-3 h-3" />
                <span>
                  Unreachable States ({validation.unreachableStates.length})
                </span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.unreachableStates.map((id) => {
                  const state = states.find((s) => s.id === id)
                  return (
                    <button
                      key={id}
                      className="text-xs text-gray-400 hover:text-white block"
                      onClick={() => onIssueClick("unreachable", id)}
                    >
                      {state?.name || "Unknown"}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {validation.deadEndStates.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                <Eye className="w-3 h-3" />
                <span>Dead-end States ({validation.deadEndStates.length})</span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.deadEndStates.map((id) => {
                  const state = states.find((s) => s.id === id)
                  return (
                    <button
                      key={id}
                      className="text-xs text-gray-400 hover:text-white block"
                      onClick={() => onIssueClick("deadend", id)}
                    >
                      {state?.name || "Unknown"}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// Bulk Creation Wizard
function BulkCreationWizard({
  states,
  workflows,
  onComplete,
}: {
  states: State[]
  workflows: Workflow[]
  onComplete: (transitions: Transition[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [sourceStates, setSourceStates] = useState<string[]>([])
  const [targetStates, setTargetStates] = useState<string[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [config, setConfig] = useState({
    timeout: 10000,
    retryCount: 0,
    workflows: [] as string[],
  })

  const handleComplete = () => {
    const newTransitions: Transition[] = []

    sourceStates.forEach((fromStateId) => {
      targetStates.forEach((toStateId) => {
        const transition: OutgoingTransition = {
          id: `transition-${Date.now()}-${Math.random()}`,
          type: "OutgoingTransition",
          fromState: fromStateId,
          activateStates: [toStateId],
          staysVisible: false,
          deactivateStates: [],
          workflows: config.workflows,
          timeout: config.timeout,
          retryCount: config.retryCount,
        }
        newTransitions.push(transition)
      })
    })

    onComplete(newTransitions)
    setOpen(false)
    setStep(1)
    setSourceStates([])
    setTargetStates([])
    setSelectedTemplate("")
    setConfig({ timeout: 10000, retryCount: 0, workflows: [] })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white">
          <Layers className="w-4 h-4 mr-2" />
          Bulk Create
        </Button>
      </DialogTrigger>

      <DialogContent className="bg-[#27272A] border-gray-700 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#BD00FF]">
            Bulk Transition Creation
          </DialogTitle>
          <DialogDescription>
            Step {step} of 4 - Create multiple transitions at once
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 1 && (
            <div className="space-y-3">
              <Label>Select Source States</Label>
              <ScrollArea className="h-[300px] border border-gray-700 rounded p-3">
                <div className="space-y-2">
                  {states.map((state) => (
                    <div key={state.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={sourceStates.includes(state.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSourceStates([...sourceStates, state.id])
                          } else {
                            setSourceStates(
                              sourceStates.filter((id) => id !== state.id)
                            )
                          }
                        }}
                      />
                      <Label className="cursor-pointer">{state.name}</Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-xs text-gray-400">
                Selected: {sourceStates.length} state(s)
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Label>Select Target States</Label>
              <ScrollArea className="h-[300px] border border-gray-700 rounded p-3">
                <div className="space-y-2">
                  {states.map((state) => (
                    <div key={state.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={targetStates.includes(state.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setTargetStates([...targetStates, state.id])
                          } else {
                            setTargetStates(
                              targetStates.filter((id) => id !== state.id)
                            )
                          }
                        }}
                      />
                      <Label className="cursor-pointer">{state.name}</Label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-xs text-gray-400">
                Selected: {targetStates.length} state(s)
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <Label>Configure Transitions</Label>

              <div className="space-y-3 border border-gray-700 rounded p-4">
                <div className="space-y-2">
                  <Label className="text-xs">Timeout (ms)</Label>
                  <Input
                    type="number"
                    value={config.timeout}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        timeout: parseInt(e.target.value) || 0,
                      })
                    }
                    className="bg-transparent border-gray-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Retry Count</Label>
                  <Input
                    type="number"
                    value={config.retryCount}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        retryCount: parseInt(e.target.value) || 0,
                      })
                    }
                    className="bg-transparent border-gray-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Workflows (optional)</Label>
                  <Select
                    value=""
                    onValueChange={(value) =>
                      setConfig({
                        ...config,
                        workflows: [...config.workflows, value],
                      })
                    }
                  >
                    <SelectTrigger className="bg-transparent border-gray-700">
                      <SelectValue placeholder="Add workflow..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows
                        .filter((w) => !config.workflows.includes(w.id))
                        .map((workflow) => (
                          <SelectItem key={workflow.id} value={workflow.id}>
                            {workflow.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {config.workflows.length > 0 && (
                    <div className="space-y-1">
                      {config.workflows.map((wId) => {
                        const workflow = workflows.find((w) => w.id === wId)
                        return (
                          <div
                            key={wId}
                            className="flex items-center justify-between p-2 bg-gray-800 rounded"
                          >
                            <span className="text-sm">
                              {workflow?.name || "Unknown"}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-red-400"
                              onClick={() =>
                                setConfig({
                                  ...config,
                                  workflows: config.workflows.filter(
                                    (id) => id !== wId
                                  ),
                                })
                              }
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <Label>Preview</Label>
              <div className="border border-gray-700 rounded p-4 space-y-2">
                <p className="text-sm text-gray-400">
                  Will create{" "}
                  <span className="text-[#00D9FF] font-medium">
                    {sourceStates.length * targetStates.length}
                  </span>{" "}
                  transition(s)
                </p>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-1 text-xs">
                    {sourceStates.map((fromId) =>
                      targetStates.map((toId) => (
                        <div
                          key={`${fromId}-${toId}`}
                          className="flex items-center gap-2 p-2 bg-gray-800 rounded"
                        >
                          <span>
                            {states.find((s) => s.id === fromId)?.name}
                          </span>
                          <ArrowRight className="w-3 h-3" />
                          <span>
                            {states.find((s) => s.id === toId)?.name}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <Button
              variant="outline"
              onClick={() => setStep(Math.max(1, step - 1))}
              disabled={step === 1}
              className="border-gray-700"
            >
              Previous
            </Button>
            <span className="text-xs text-gray-400">
              Step {step} of 4
            </span>
            {step < 4 ? (
              <Button
                onClick={() => setStep(Math.min(4, step + 1))}
                disabled={
                  (step === 1 && sourceStates.length === 0) ||
                  (step === 2 && targetStates.length === 0)
                }
                className="bg-[#BD00FF] hover:bg-[#BD00FF]/80"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                className="bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
              >
                Create Transitions
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function TransitionManager() {
  const { states, workflows, transitions, addTransition, updateTransition, deleteTransition } =
    useAutomation()

  // State
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [filters, setFilters] = useState<TransitionFilters>(DEFAULT_FILTERS)
  const [selectedTransitions, setSelectedTransitions] = useState<Set<string>>(
    new Set()
  )
  const [selectedTransition, setSelectedTransition] = useState<Transition | null>(
    null
  )
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [transitionToDelete, setTransitionToDelete] = useState<string | null>(
    null
  )

  // Validation
  const validation = useMemo(
    () => analyzeTransitions(transitions, states),
    [transitions, states]
  )

  // Handlers
  const handleTransitionSelect = useCallback(
    (id: string, selected: boolean) => {
      const newSelection = new Set(selectedTransitions)
      if (selected) {
        newSelection.add(id)
      } else {
        newSelection.delete(id)
      }
      setSelectedTransitions(newSelection)
    },
    [selectedTransitions]
  )

  const handleBulkDelete = useCallback(() => {
    selectedTransitions.forEach((id) => deleteTransition(id))
    setSelectedTransitions(new Set())
    toast.success(`Deleted ${selectedTransitions.size} transition(s)`)
  }, [selectedTransitions, deleteTransition])

  const handleBulkCreate = useCallback(
    (newTransitions: Transition[]) => {
      newTransitions.forEach((t) => addTransition(t))
      toast.success(`Created ${newTransitions.length} transition(s)`)
    },
    [addTransition]
  )

  const handleExport = useCallback(() => {
    const data = JSON.stringify(transitions, null, 2)
    const blob = new Blob([data], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `transitions-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Transitions exported")
  }, [transitions])

  const handleMatrixCellClick = useCallback(
    (fromState: string, toState: string) => {
      const matchingTransitions = transitions.filter(
        (t): t is OutgoingTransition =>
          t.type === "OutgoingTransition" &&
          t.fromState === fromState &&
          t.activateStates.includes(toState)
      )

      if (matchingTransitions.length === 1) {
        setSelectedTransition(matchingTransitions[0])
      } else if (matchingTransitions.length > 1) {
        // Show a dialog to select which transition to edit
        setSelectedTransition(matchingTransitions[0])
      } else {
        // No transition exists, could create one
        toast.info("No transition exists for this cell")
      }
    },
    [transitions]
  )

  const handleDeleteConfirm = useCallback(() => {
    if (transitionToDelete) {
      deleteTransition(transitionToDelete)
      setTransitionToDelete(null)
      setDeleteDialogOpen(false)
      setSelectedTransition(null)
      toast.success("Transition deleted")
    }
  }, [transitionToDelete, deleteTransition])

  return (
    <div className="h-screen flex flex-col bg-[#1A1A1B] text-white">
      {/* Top Toolbar */}
      <div className="flex-shrink-0 border-b border-gray-700 bg-[#27272A] p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-[#00D9FF]">
            Transition Manager
          </h1>
          <div className="flex items-center gap-2">
            <BulkCreationWizard
              states={states}
              workflows={workflows}
              onComplete={handleBulkCreate}
            />
            <Button
              variant="outline"
              onClick={handleExport}
              className="border-gray-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            {selectedTransitions.size > 0 && (
              <Button
                variant="outline"
                onClick={handleBulkDelete}
                className="border-red-400 text-red-400 hover:bg-red-400/20"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete ({selectedTransitions.size})
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search transitions..."
              value={filters.searchQuery}
              onChange={(e) =>
                setFilters({ ...filters, searchQuery: e.target.value })
              }
              className="pl-8 bg-transparent border-gray-700"
            />
          </div>

          <Select
            value={filters.fromState}
            onValueChange={(value) =>
              setFilters({ ...filters, fromState: value })
            }
          >
            <SelectTrigger className="bg-transparent border-gray-700">
              <SelectValue placeholder="From State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All From States</SelectItem>
              {states.map((state) => (
                <SelectItem key={state.id} value={state.id}>
                  {state.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.toState}
            onValueChange={(value) =>
              setFilters({ ...filters, toState: value })
            }
          >
            <SelectTrigger className="bg-transparent border-gray-700">
              <SelectValue placeholder="To State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All To States</SelectItem>
              {states.map((state) => (
                <SelectItem key={state.id} value={state.id}>
                  {state.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.actionType}
            onValueChange={(value: any) =>
              setFilters({ ...filters, actionType: value })
            }
          >
            <SelectTrigger className="bg-transparent border-gray-700">
              <SelectValue placeholder="Action Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="with_workflow">With Workflow</SelectItem>
              <SelectItem value="without_workflow">Without Workflow</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* View Mode Tabs */}
        <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)} className="mt-4">
          <TabsList className="bg-[#1A1A1B]">
            <TabsTrigger value="list" className="data-[state=active]:bg-[#27272A]">
              <List className="w-4 h-4 mr-2" />
              List
            </TabsTrigger>
            <TabsTrigger value="matrix" className="data-[state=active]:bg-[#27272A]">
              <Grid3x3 className="w-4 h-4 mr-2" />
              Matrix
            </TabsTrigger>
            <TabsTrigger value="graph" className="data-[state=active]:bg-[#27272A]">
              <Network className="w-4 h-4 mr-2" />
              Graph
            </TabsTrigger>
            <TabsTrigger value="statistics" className="data-[state=active]:bg-[#27272A]">
              <BarChart3 className="w-4 h-4 mr-2" />
              Statistics
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Left Panel - Transition View */}
        <div className="flex-[7] flex flex-col gap-4 overflow-hidden">
          {/* Validation Panel */}
          <ValidationPanel
            validation={validation}
            states={states}
            transitions={transitions}
            onIssueClick={(type, id) => {
              const transition = transitions.find((t) => t.id === id)
              if (transition) {
                setSelectedTransition(transition)
              }
            }}
          />

          {/* Main View */}
          <Card className="flex-1 border-gray-700 bg-[#27272A] overflow-hidden">
            <CardContent className="p-4 h-full">
              {viewMode === "list" && (
                <TransitionList
                  transitions={transitions}
                  states={states}
                  workflows={workflows}
                  validation={validation}
                  filters={filters}
                  selectedTransitions={selectedTransitions}
                  onTransitionSelect={handleTransitionSelect}
                  onTransitionClick={setSelectedTransition}
                  onTransitionDelete={(id) => {
                    setTransitionToDelete(id)
                    setDeleteDialogOpen(true)
                  }}
                />
              )}

              {viewMode === "matrix" && (
                <TransitionMatrix
                  transitions={transitions}
                  states={states}
                  validation={validation}
                  onTransitionClick={handleMatrixCellClick}
                />
              )}

              {viewMode === "graph" && (
                <TransitionGraph
                  transitions={transitions}
                  states={states}
                  onTransitionClick={setSelectedTransition}
                />
              )}

              {viewMode === "statistics" && (
                <StatisticsDashboard
                  transitions={transitions}
                  states={states}
                  validation={validation}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Transition Editor */}
        <div className="flex-[3] overflow-hidden">
          <TransitionEditor
            transition={selectedTransition}
            states={states}
            workflows={workflows}
            onUpdate={(updates) => {
              if (selectedTransition) {
                updateTransition({ ...selectedTransition, ...updates })
              }
            }}
            onDelete={() => {
              if (selectedTransition) {
                setTransitionToDelete(selectedTransition.id)
                setDeleteDialogOpen(true)
              }
            }}
            onClose={() => setSelectedTransition(null)}
          />
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-[#27272A] border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#FF4444]">
              Delete Transition
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this transition? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-400 hover:bg-red-500 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
