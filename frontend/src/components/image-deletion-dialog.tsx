"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

export interface ImageUsageInfo {
  states: Array<{ id: string; name: string }>
  processes: Array<{ id: string; name: string; actionCount: number }>
}

interface ImageDeletionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageName: string
  usageInfo: ImageUsageInfo
  onConfirmDelete: () => void
}

export function ImageDeletionDialog({
  open,
  onOpenChange,
  imageName,
  usageInfo,
  onConfirmDelete,
}: ImageDeletionDialogProps) {
  const hasUsage = usageInfo.states.length > 0 || usageInfo.processes.length > 0
  const totalStates = usageInfo.states.length
  const totalProcesses = usageInfo.processes.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#27272A] border-gray-700 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {hasUsage && <AlertTriangle className="w-6 h-6 text-yellow-500" />}
            {hasUsage ? "Warning: Image In Use" : "Delete Image?"}
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            {hasUsage
              ? "This image is currently being used in your automation."
              : `Are you sure you want to delete "${imageName}"?`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {hasUsage ? (
            <>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-sm text-yellow-200 font-medium mb-2">
                  Deleting this image will:
                </p>
                <ul className="text-sm text-yellow-100 space-y-1 list-disc list-inside">
                  {totalStates > 0 && (
                    <li>Remove it from {totalStates} state{totalStates > 1 ? "s" : ""}</li>
                  )}
                  {totalProcesses > 0 && (
                    <li>
                      Mark it as [REMOVED] in {totalProcesses} workflow
                      {totalProcesses > 1 ? "s" : ""}
                    </li>
                  )}
                </ul>
              </div>

              {totalStates > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-300">
                    Used in States ({totalStates}):
                  </h4>
                  <div className="max-h-32 overflow-y-auto bg-gray-800/50 rounded-lg p-3 space-y-1">
                    {usageInfo.states.map((state) => (
                      <div key={state.id} className="text-sm text-gray-300 flex items-center gap-2">
                        <span className="w-2 h-2 bg-[#00FF88] rounded-full flex-shrink-0" />
                        {state.name || state.id}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {totalProcesses > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-300">
                    Used in Workflows ({totalProcesses}):
                  </h4>
                  <div className="max-h-32 overflow-y-auto bg-gray-800/50 rounded-lg p-3 space-y-1">
                    {usageInfo.processes.map((process) => (
                      <div key={process.id} className="text-sm text-gray-300 flex items-center gap-2">
                        <span className="w-2 h-2 bg-[#BD00FF] rounded-full flex-shrink-0" />
                        {process.name || process.id}
                        <span className="text-xs text-gray-500">
                          ({process.actionCount} action{process.actionCount > 1 ? "s" : ""})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-sm text-red-200">
                  Images removed from workflows will be displayed as{" "}
                  <span className="font-mono text-red-400">[REMOVED: {imageName}]</span> in red text.
                  The workflow structure will be preserved but the image will be unavailable.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">
              This image is not currently being used and can be safely deleted.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-gray-600 hover:bg-gray-800"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirmDelete()
              onOpenChange(false)
            }}
            className={
              hasUsage
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
            }
          >
            {hasUsage ? "Delete Anyway" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
