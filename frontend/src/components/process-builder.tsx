"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Play } from "lucide-react"
import { ProcessList } from "@/components/process-list"
import { ActionEditor } from "@/components/action-editor"
import { ActionProperties } from "@/components/action-properties"
import { useAutomation } from "@/contexts/automation-context"

interface Process {
  id: string
  name: string
  description: string
  category?: string
  actions: Action[]
}

interface Action {
  id: string
  type: "FIND" | "FIND_STATE_IMAGE" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH" | "GO_TO_STATE" | "RUN_PROCESS"
  config: Record<string, any>
}

export function ProcessBuilder() {
  const [selectedProcess, setSelectedProcess] = useState<Process | null>(null)
  const [selectedAction, setSelectedAction] = useState<Action | null>(null)
  const { processes, addProcess, updateProcess, deleteProcess, categories } = useAutomation()

  // Get all unique categories from processes and context
  const allCategories = [...new Set(["Main", "Transitions", ...categories, ...processes.map(p => p.category || "Main")])]

  // Keep selectedProcess in sync with the processes from context
  useEffect(() => {
    if (selectedProcess) {
      const updatedProcess = processes.find(p => p.id === selectedProcess.id)
      if (updatedProcess && updatedProcess !== selectedProcess) {
        setSelectedProcess(updatedProcess)
        // Also update selectedAction if it exists
        if (selectedAction) {
          const updatedAction = updatedProcess.actions.find(a => a.id === selectedAction.id)
          if (updatedAction) {
            setSelectedAction(updatedAction)
          }
        }
      }
    }
  }, [processes, selectedProcess?.id, selectedAction?.id])

  const createNewProcess = () => {
    const newProcess: Process = {
      id: `process-${Date.now()}`,
      name: "New Process",
      description: "",
      category: "Main",
      actions: [],
    }
    addProcess(newProcess)
    setSelectedProcess(newProcess)
  }

  const handleUpdateProcess = (updatedProcess: Process) => {
    updateProcess(updatedProcess)
    // Don't set selectedProcess here - let useEffect handle it
  }

  const handleDeleteProcess = (processId: string) => {
    deleteProcess(processId)
    if (selectedProcess?.id === processId) {
      setSelectedProcess(null)
      setSelectedAction(null)
    }
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Process Library */}
      <div className="flex-[2] min-w-[300px] max-w-[600px] border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <Button
            onClick={createNewProcess}
            className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Process
          </Button>

          <ProcessList
            processes={processes}
            selectedProcess={selectedProcess}
            onSelectProcess={setSelectedProcess}
            onDeleteProcess={handleDeleteProcess}
            onUpdateProcess={handleUpdateProcess}
          />
        </div>
      </div>

      {/* Center Panel - Process Editor */}
      <div className="flex-[3] min-w-[400px] p-6 overflow-y-auto">
        {selectedProcess ? (
          <div className="space-y-6">
            <div className="space-y-4">
              <Input
                value={selectedProcess.name}
                onChange={(e) => {
                  const updated = { ...selectedProcess, name: e.target.value }
                  handleUpdateProcess(updated)
                }}
                className="text-xl font-bold bg-transparent border-gray-700 focus:border-[#00D9FF]"
                placeholder="Process name"
              />

              <Textarea
                value={selectedProcess.description}
                onChange={(e) => {
                  const updated = { ...selectedProcess, description: e.target.value }
                  handleUpdateProcess(updated)
                }}
                className="bg-transparent border-gray-700 focus:border-[#00D9FF]"
                placeholder="Process description"
                rows={2}
              />

              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">Category:</label>
                <Select
                  value={selectedProcess.category || "Main"}
                  onValueChange={(value) => {
                    const updated = { ...selectedProcess, category: value }
                    handleUpdateProcess(updated)
                  }}
                >
                  <SelectTrigger className="w-48 bg-transparent border-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allCategories.map(category => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ActionEditor
              process={selectedProcess}
              selectedAction={selectedAction}
              onSelectAction={setSelectedAction}
              onUpdateProcess={handleUpdateProcess}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Select a process to edit</p>
              <p className="text-sm">or create a new one to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Action Properties */}
      <div className="flex-[2] min-w-[300px] max-w-[600px] border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <ActionProperties
          action={selectedAction}
          onUpdateAction={(updated) => {
            if (selectedProcess && selectedAction) {
              const updatedProcess = {
                ...selectedProcess,
                actions: selectedProcess.actions.map((a) => (a.id === updated.id ? updated : a)),
              }
              handleUpdateProcess(updatedProcess)
              // useEffect will handle updating selectedAction
            }
          }}
        />
      </div>
    </div>
  )
}
