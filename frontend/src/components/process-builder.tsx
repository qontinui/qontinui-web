"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Play } from "lucide-react"
import { ProcessList } from "@/components/process-list"
import { ActionEditor } from "@/components/action-editor"
import { ActionProperties } from "@/components/action-properties"
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

export function ProcessBuilder() {
  const [selectedProcess, setSelectedProcess] = useState<Process | null>(null)
  const [selectedAction, setSelectedAction] = useState<Action | null>(null)
  const { processes, addProcess, updateProcess, deleteProcess } = useAutomation()

  const createNewProcess = () => {
    const newProcess: Process = {
      id: `process-${Date.now()}`,
      name: "New Process",
      description: "",
      actions: [],
    }
    addProcess(newProcess)
    setSelectedProcess(newProcess)
  }

  const handleUpdateProcess = (updatedProcess: Process) => {
    updateProcess(updatedProcess)
    setSelectedProcess(updatedProcess)
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
      <div className="w-80 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
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
          />
        </div>
      </div>

      {/* Center Panel - Process Editor */}
      <div className="flex-1 p-6 overflow-y-auto">
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
      <div className="w-80 border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <ActionProperties
          action={selectedAction}
          onUpdateAction={(updated) => {
            if (selectedProcess && selectedAction) {
              const updatedProcess = {
                ...selectedProcess,
                actions: selectedProcess.actions.map((a) => (a.id === updated.id ? updated : a)),
              }
              handleUpdateProcess(updatedProcess)
              setSelectedAction(updated)
            }
          }}
        />
      </div>
    </div>
  )
}
