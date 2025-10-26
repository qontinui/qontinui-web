"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, X, ChevronUp, ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface Process {
  id: string
  name: string
  description: string
  category?: string
}

interface State {
  id: string
  name: string
  description: string
}

interface OutgoingTransition {
  id: string
  type: "OutgoingTransition"
  fromState: string
  activateStates: string[]
  staysVisible: boolean
  deactivateStates: string[]
  process: string
}

interface IncomingTransition {
  id: string
  type: "IncomingTransition"
  toState: string
  process: string
}

type Transition = OutgoingTransition | IncomingTransition

interface TransitionPropertiesPanelProps {
  transition: Transition
  states: State[]
  processes: Process[]
  updateTransition: (updates: Partial<Transition>) => void
  deleteTransition: (transitionId: string) => void
}

export function TransitionPropertiesPanel({
  transition,
  states,
  processes,
  updateTransition,
  deleteTransition,
}: TransitionPropertiesPanelProps) {
  const [stateDialogOpen, setStateDialogOpen] = useState(false)
  const [selectedStateType, setSelectedStateType] = useState<"activate" | "deactivate">("activate")
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false)
  const [workflowCategoryFilter, setWorkflowCategoryFilter] = useState<string>("Transitions")

  const handleAddState = (stateId: string, type: "activate" | "deactivate") => {
    if (transition.type !== "OutgoingTransition") return

    const key = type === "activate" ? "activateStates" : "deactivateStates"
    const currentStates = Array.isArray(transition[key]) ? transition[key] : []

    if (!currentStates.includes(stateId)) {
      updateTransition({
        [key]: [...currentStates, stateId],
      } as Partial<OutgoingTransition>)
    }
    setStateDialogOpen(false)
  }

  const handleRemoveState = (stateId: string, type: "activate" | "deactivate") => {
    if (transition.type !== "OutgoingTransition") return

    const key = type === "activate" ? "activateStates" : "deactivateStates"
    const currentStates = Array.isArray(transition[key]) ? transition[key] : []
    updateTransition({
      [key]: currentStates.filter((id) => id !== stateId),
    } as Partial<OutgoingTransition>)
  }

  const handleAddWorkflow = (workflowId: string) => {
    const currentWorkflows = transition.workflows || []
    // Check if workflow is already added
    const alreadyAdded = currentWorkflows.some(ref => ref.workflowId === workflowId)

    if (!alreadyAdded) {
      updateTransition({
        workflows: [...currentWorkflows, { type: 'reference' as const, workflowId }],
      })
    }
    setWorkflowDialogOpen(false)
  }

  const handleRemoveWorkflow = (workflowId: string) => {
    const currentWorkflows = transition.workflows || []
    updateTransition({
      workflows: currentWorkflows.filter(ref => ref.workflowId !== workflowId),
    })
  }

  const handleMoveWorkflowUp = (index: number) => {
    if (index === 0) return
    const currentWorkflows = [...(transition.workflows || [])]
    ;[currentWorkflows[index], currentWorkflows[index - 1]] = [currentWorkflows[index - 1], currentWorkflows[index]]
    updateTransition({ workflows: currentWorkflows })
  }

  const handleMoveWorkflowDown = (index: number) => {
    const currentWorkflows = transition.workflows || []
    if (index === currentWorkflows.length - 1) return
    const newWorkflows = [...currentWorkflows]
    ;[newWorkflows[index], newWorkflows[index + 1]] = [newWorkflows[index + 1], newWorkflows[index]]
    updateTransition({ workflows: newWorkflows })
  }

  const availableStates = states.filter((state) => {
    if (transition.type !== "OutgoingTransition") return false
    if (state.id === transition.fromState) return false

    const activateStates = Array.isArray(transition.activateStates) ? transition.activateStates : []
    const deactivateStates = Array.isArray(transition.deactivateStates) ? transition.deactivateStates : []

    return selectedStateType === "activate"
      ? !activateStates.includes(state.id) && !deactivateStates.includes(state.id)
      : !deactivateStates.includes(state.id) && !activateStates.includes(state.id)
  })

  // Get unique categories from workflows
  const workflowCategories = Array.from(new Set(processes.map(p => p.category || "Main")))

  // Filter workflows by category
  const filteredWorkflows = processes.filter(p => {
    const category = p.category || "Main"
    return workflowCategoryFilter === "All" || category === workflowCategoryFilter
  })

  // Filter out already selected workflows
  const availableWorkflows = filteredWorkflows.filter(p => {
    const currentWorkflows = transition.workflows || []
    return !currentWorkflows.some(ref => ref.workflowId === p.id)
  })

  return (
    <Card className="border-gray-700 bg-[#27272A] h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-[#BD00FF]">Transition Properties</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-400/20"
            onClick={() => deleteTransition(transition.id)}
            title="Delete Transition"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Type</Label>
          <div className="p-2 bg-gray-800 rounded text-sm">
            {transition.type === "OutgoingTransition" ? (
              <span className="text-[#BD00FF]">OutgoingTransition</span>
            ) : (
              <span className="text-[#00FF88]">IncomingTransition</span>
            )}
          </div>
        </div>

        {transition.type === "OutgoingTransition" ? (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">From State</Label>
              <div className="p-2 bg-gray-800 rounded text-sm">
                {states.find((s) => s.id === transition.fromState)?.name || "Unknown State"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-400">States to Activate</Label>
                <Dialog open={stateDialogOpen && selectedStateType === "activate"} onOpenChange={setStateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-gray-400 hover:text-gray-300"
                      onClick={() => {
                        setSelectedStateType("activate")
                        setStateDialogOpen(true)
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-[#27272A] border-gray-700">
                    <DialogHeader>
                      <DialogTitle className="text-[#00D9FF]">
                        Add State to Activate
                      </DialogTitle>
                      <DialogDescription className="text-gray-400 text-sm">
                        Select a state to activate when this transition occurs
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {availableStates.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">No available states</p>
                      ) : (
                        availableStates.map((state) => (
                          <Button
                            key={state.id}
                            variant="outline"
                            className="w-full justify-start bg-transparent border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                            onClick={() => handleAddState(state.id, "activate")}
                          >
                            {state.name}
                          </Button>
                        ))
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              {(!Array.isArray(transition.activateStates) || transition.activateStates.length === 0) ? (
                <div className="p-2 bg-gray-800 rounded text-sm text-gray-500 text-center">
                  No states to activate
                </div>
              ) : (
                <div className="space-y-1">
                  {transition.activateStates.map((stateId) => (
                    <div
                      key={stateId}
                      className="flex items-center justify-between p-2 bg-gray-800 rounded"
                    >
                      <span className="text-sm">
                        {states.find((s) => s.id === stateId)?.name || "Unknown State"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                        onClick={() => handleRemoveState(stateId, "activate")}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="stays_visible"
                checked={transition.staysVisible}
                onCheckedChange={(checked) =>
                  updateTransition({ staysVisible: !!checked } as Partial<OutgoingTransition>)
                }
              />
              <Label htmlFor="stays_visible" className="text-xs text-gray-400">
                Origin state stays visible
              </Label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-400">States to Deactivate</Label>
                <Dialog open={stateDialogOpen && selectedStateType === "deactivate"} onOpenChange={setStateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-gray-400 hover:text-gray-300"
                      onClick={() => {
                        setSelectedStateType("deactivate")
                        setStateDialogOpen(true)
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-[#27272A] border-gray-700">
                    <DialogHeader>
                      <DialogTitle className="text-[#00D9FF]">
                        Add State to Deactivate
                      </DialogTitle>
                      <DialogDescription className="text-gray-400 text-sm">
                        Select a state to deactivate when this transition occurs
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {availableStates.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">No available states</p>
                      ) : (
                        availableStates.map((state) => (
                          <Button
                            key={state.id}
                            variant="outline"
                            className="w-full justify-start bg-transparent border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                            onClick={() => handleAddState(state.id, "deactivate")}
                          >
                            {state.name}
                          </Button>
                        ))
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              {(!Array.isArray(transition.deactivateStates) || transition.deactivateStates.length === 0) ? (
                <div className="p-2 bg-gray-800 rounded text-sm text-gray-500 text-center">
                  No states to deactivate
                </div>
              ) : (
                <div className="space-y-1">
                  {transition.deactivateStates.map((stateId) => (
                    <div
                      key={stateId}
                      className="flex items-center justify-between p-2 bg-gray-800 rounded"
                    >
                      <span className="text-sm">
                        {states.find((s) => s.id === stateId)?.name || "Unknown State"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                        onClick={() => handleRemoveState(stateId, "deactivate")}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">State (executes when entering)</Label>
            <div className="p-2 bg-gray-800 rounded text-sm">
              {states.find((s) => s.id === transition.toState)?.name || "Unknown State"}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">Workflows to Execute</Label>
            <Dialog open={workflowDialogOpen} onOpenChange={setWorkflowDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-gray-400 hover:text-gray-300"
                  onClick={() => setWorkflowDialogOpen(true)}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#27272A] border-gray-700 max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-[#00D9FF]">
                    Add Workflow to Execute
                  </DialogTitle>
                  <DialogDescription className="text-gray-400 text-sm">
                    Select workflows to execute when this transition occurs
                  </DialogDescription>
                </DialogHeader>

                {/* Category Filter */}
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">Filter by Category</Label>
                  <Select value={workflowCategoryFilter} onValueChange={setWorkflowCategoryFilter}>
                    <SelectTrigger className="bg-transparent border-gray-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#27272A] border-gray-700">
                      <SelectItem value="All">All Categories</SelectItem>
                      {workflowCategories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Workflow List */}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {availableWorkflows.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">
                      {workflowCategoryFilter === "Transitions"
                        ? "No workflows in Transitions category. Try 'All Categories' to see all workflows."
                        : "No available workflows"}
                    </p>
                  ) : (
                    availableWorkflows.map((workflow) => (
                      <Button
                        key={workflow.id}
                        variant="outline"
                        className="w-full justify-start bg-transparent border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                        onClick={() => handleAddWorkflow(workflow.id)}
                      >
                        <div className="flex flex-col items-start gap-1 w-full">
                          <div className="flex items-center gap-2">
                            <span>{workflow.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {workflow.category || "Main"}
                            </Badge>
                          </div>
                          {workflow.description && (
                            <span className="text-xs text-gray-400">{workflow.description}</span>
                          )}
                        </div>
                      </Button>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Selected Workflows List */}
          {(!transition.workflows || transition.workflows.length === 0) ? (
            <div className="p-2 bg-gray-800 rounded text-sm text-gray-500 text-center">
              No workflows selected
            </div>
          ) : (
            <div className="space-y-1">
              {transition.workflows.map((workflowRef, index) => {
                const workflowId = workflowRef.workflowId
                const workflow = processes.find(p => p.id === workflowId)
                return (
                  <div
                    key={workflowId}
                    className="flex items-center justify-between p-2 bg-gray-800 rounded"
                  >
                    <div className="flex flex-col gap-1 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/50">
                          {index + 1}
                        </Badge>
                        <span className="text-sm">
                          {workflow?.name || "Unknown Workflow"}
                        </span>
                        {workflow?.category && (
                          <Badge variant="outline" className="text-xs">
                            {workflow.category}
                          </Badge>
                        )}
                      </div>
                      {workflow?.description && (
                        <span className="text-xs text-gray-400 ml-6">{workflow.description}</span>
                      )}
                    </div>

                    {/* Reorder and Delete Buttons */}
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200"
                        disabled={index === 0}
                        onClick={() => handleMoveWorkflowUp(index)}
                      >
                        <ChevronUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200"
                        disabled={index === transition.workflows.length - 1}
                        onClick={() => handleMoveWorkflowDown(index)}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                        onClick={() => handleRemoveWorkflow(workflowId)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>


      </CardContent>
    </Card>
  )
}
