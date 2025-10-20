"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ArrowDownToLine } from "lucide-react"
import { toast } from "sonner"
import { useAutomation } from "@/contexts/automation-context"

interface IncomingTransitionBuilderProps {
  preselectedProcess?: string
  onClose?: () => void
}

export function IncomingTransitionBuilder({ preselectedProcess, onClose }: IncomingTransitionBuilderProps = {}) {
  const { states, workflows, addTransition } = useAutomation()
  const [open, setOpen] = useState(!!preselectedProcess)

  // IncomingTransition fields
  const [toState, setToState] = useState("")
  const [selectedProcess, setSelectedProcess] = useState(preselectedProcess || "")

  const handleCreate = () => {
    if (!toState) {
      toast.error("Please select a state")
      return
    }

    if (!selectedProcess) {
      toast.error("Please select a process to execute")
      return
    }

    const newTransition = {
      id: `transition-${Date.now()}`,
      type: "IncomingTransition" as const,
      toState,
      process: selectedProcess
    }

    addTransition(newTransition)
    toast.success("Incoming transition created")

    // Reset form
    setToState("")
    setSelectedProcess("")
    setOpen(false)
    onClose?.()
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      onClose?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!preselectedProcess && (
        <DialogTrigger asChild>
          <Button className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black">
            <ArrowDownToLine className="w-4 h-4 mr-2" />
            Create Incoming Transition
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="bg-[#27272A] border-gray-700 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#00D9FF]">Create Incoming Transition</DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            Define a process that executes when entering a state
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>State (executes when entering)</Label>
            <Select value={toState} onValueChange={setToState}>
              <SelectTrigger className="bg-transparent border-gray-600 mt-2">
                <SelectValue placeholder="Select state" />
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

          <div className="p-4 bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-400">
              IncomingTransitions are executed automatically after any successful OutgoingTransition
              that navigates to this state. They're useful for setup actions that should
              always happen when entering a state.
            </p>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <Label>Process to Execute</Label>
            <Select value={selectedProcess} onValueChange={setSelectedProcess}>
              <SelectTrigger className="bg-transparent border-gray-600 mt-2">
                <SelectValue placeholder="Select a process to execute" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {workflows.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No workflows available
                  </SelectItem>
                ) : (
                  workflows.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name} ({workflow.actions.length} actions)
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedProcess && workflows.find(w => w.id === selectedProcess)?.description && (
              <p className="text-xs text-gray-400 mt-2">
                {workflows.find(w => w.id === selectedProcess)?.description}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="px-8 border-gray-600"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              className="px-8 bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
            >
              Create Incoming Transition
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
