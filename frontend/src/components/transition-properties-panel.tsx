"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, X } from "lucide-react"
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

  const handleAddState = (stateId: string, type: "activate" | "deactivate") => {
    if (transition.type !== "OutgoingTransition") return

    const key = type === "activate" ? "activateStates" : "deactivateStates"
    const currentStates = transition[key]

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
    updateTransition({
      [key]: transition[key].filter((id) => id !== stateId),
    } as Partial<OutgoingTransition>)
  }

  const handleSelectProcess = (processId: string) => {
    updateTransition({
      process: processId,
    })
  }

  const availableStates = states.filter(
    (state) =>
      transition.type === "OutgoingTransition" &&
      state.id !== transition.fromState &&
      (selectedStateType === "activate"
        ? !transition.activateStates.includes(state.id) && !transition.deactivateStates.includes(state.id)
        : !transition.deactivateStates.includes(state.id) && !transition.activateStates.includes(state.id))
  )

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
              {transition.activateStates.length === 0 ? (
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
              {transition.deactivateStates.length === 0 ? (
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
          <Label className="text-xs text-gray-400">Process to Execute</Label>
          <Select value={transition.process || "none"} onValueChange={(value) => handleSelectProcess(value === "none" ? "" : value)}>
            <SelectTrigger className="bg-transparent border-gray-700">
              <SelectValue placeholder="Select a process" />
            </SelectTrigger>
            <SelectContent className="bg-[#27272A] border-gray-700">
              <SelectItem value="none">None</SelectItem>
              {processes.map((process) => (
                <SelectItem key={process.id} value={process.id}>
                  {process.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {transition.process && (
            <div className="text-xs text-gray-400 mt-1">
              {processes.find(p => p.id === transition.process)?.description || ""}
            </div>
          )}
        </div>


      </CardContent>
    </Card>
  )
}
