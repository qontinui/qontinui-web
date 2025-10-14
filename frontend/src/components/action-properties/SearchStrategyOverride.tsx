"use client"

import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, X } from "lucide-react"
import { Action } from "./types"

interface SearchStrategyOverrideProps {
  action: Action
  updateConfig: (key: string, value: any) => void
}

/**
 * Reusable search strategy override component for FIND and FIND_STATE_IMAGE actions.
 */
export function SearchStrategyOverride({ action, updateConfig }: SearchStrategyOverrideProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-gray-400">Search Strategy Override</Label>
        {action.config.strategy !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
            onClick={() => {
              const { strategy, ...rest } = action.config
              updateConfig("__reset__", rest)
            }}
            title="Remove override (use project default)"
          >
            <X className="w-3 h-3" />
          </Button>
        ) : (
          <span className="text-xs text-gray-500">(using project default)</span>
        )}
      </div>
      {action.config.strategy !== undefined ? (
        <Select value={action.config.strategy} onValueChange={(value) => updateConfig("strategy", value)}>
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="First">First</SelectItem>
            <SelectItem value="All">All</SelectItem>
            <SelectItem value="Best">Best</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
          onClick={() => updateConfig("strategy", "First")}
        >
          <Plus className="w-3 h-3 mr-1" />
          Set Override
        </Button>
      )}
    </div>
  )
}
