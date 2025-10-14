"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Plus, X } from "lucide-react"
import { Action } from "./types"

interface TimingPropertiesProps {
  action: Action
  updateConfig: (key: string, value: any) => void
}

/**
 * Reusable timing properties component for pause_before_begin and pause_after_end.
 */
export function TimingProperties({ action, updateConfig }: TimingPropertiesProps) {
  return (
    <>
      {/* Pause Before Begin Override */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Pause Before Begin Override (ms)</Label>
          {action.config.pause_before_begin !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
              onClick={() => {
                const { pause_before_begin, ...rest } = action.config
                updateConfig("__reset__", rest)
              }}
              title="Remove override (use default 0ms)"
            >
              <X className="w-3 h-3" />
            </Button>
          ) : (
            <span className="text-xs text-gray-500">(default: 0ms)</span>
          )}
        </div>
        {action.config.pause_before_begin !== undefined ? (
          <Input
            type="number"
            min="0"
            value={action.config.pause_before_begin}
            onChange={(e) => updateConfig("pause_before_begin", Number.parseInt(e.target.value))}
            className="bg-transparent border-gray-700"
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
            onClick={() => updateConfig("pause_before_begin", 0)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Set Override
          </Button>
        )}
      </div>

      {/* Pause After End Override */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Pause After End Override (ms)</Label>
          {action.config.pause_after_end !== undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
              onClick={() => {
                const { pause_after_end, ...rest } = action.config
                updateConfig("__reset__", rest)
              }}
              title="Remove override (use default 0ms)"
            >
              <X className="w-3 h-3" />
            </Button>
          ) : (
            <span className="text-xs text-gray-500">(default: 0ms)</span>
          )}
        </div>
        {action.config.pause_after_end !== undefined ? (
          <Input
            type="number"
            min="0"
            value={action.config.pause_after_end}
            onChange={(e) => updateConfig("pause_after_end", Number.parseInt(e.target.value))}
            className="bg-transparent border-gray-700"
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
            onClick={() => updateConfig("pause_after_end", 0)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Set Override
          </Button>
        )}
      </div>
    </>
  )
}
