"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useAutomation } from "@/contexts/automation-context"

interface Process {
  id: string
  name: string
  description: string
  actions: Action[]
}

interface Action {
  id: string
  type: string
  config: Record<string, any>
}

interface ProcessListProps {
  processes: Process[]
  selectedProcess: Process | null
  onSelectProcess: (process: Process) => void
  onDeleteProcess: (processId: string) => void
}

export function ProcessList({ processes, selectedProcess, onSelectProcess, onDeleteProcess }: ProcessListProps) {
  const { transitions } = useAutomation()
  
  const getProcessUsageCount = (processId: string) => {
    // Count unique transitions that use this process
    const count = transitions.filter(t => t.processes.includes(processId)).length
    return count
  }

  const handleDelete = (processId: string, processName: string) => {
    if (confirm(`Are you sure you want to delete "${processName}"?`)) {
      onDeleteProcess(processId)
      toast.success("Process deleted", {
        description: `"${processName}" has been removed.`
      })
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Process Library</h3>

      {processes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Play className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No processes yet</p>
        </div>
      ) : (
        processes.map((process) => {
          const usageCount = getProcessUsageCount(process.id)
          return (
            <Card
              key={process.id}
              className={`cursor-pointer transition-all hover:border-[#00D9FF]/50 ${
                selectedProcess?.id === process.id ? "border-[#00D9FF] bg-[#00D9FF]/10" : "border-gray-700 bg-[#27272A]"
              }`}
              onClick={() => onSelectProcess(process)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-sm truncate">{process.name}</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(process.id, process.name)
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>

                {process.description && <p className="text-xs text-gray-400 mb-2 line-clamp-2">{process.description}</p>}

                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    {process.actions.length} actions
                  </Badge>
                  {usageCount > 0 && (
                    <Badge variant="outline" className="text-xs text-[#00FF88] border-[#00FF88]">
                      Used in {usageCount} transition{usageCount > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
