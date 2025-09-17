"use client"

import { useRef } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Settings } from "lucide-react"
import { ImageSelector } from "@/components/image-selector"
import { SpecialKeysSelector, SpecialKeyDisplay } from "@/components/special-keys-selector"
import { useAutomation } from "@/contexts/automation-context"

interface Action {
  id: string
  type: "FIND" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH" | "GO_TO_STATE" | "RUN_PROCESS"
  config: Record<string, any>
}

interface ActionPropertiesProps {
  action: Action | null
  onUpdateAction: (action: Action) => void
}

export function ActionProperties({ action, onUpdateAction }: ActionPropertiesProps) {
  const { images, updateImageUsage, removeImageUsage, states, processes } = useAutomation()

  if (!action) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Select an action</p>
          <p className="text-sm">to configure its properties</p>
        </div>
      </div>
    )
  }

  const updateConfig = (key: string, value: any) => {
    if (key === "image") {
      // Remove old image usage
      if (action.config.image) {
        removeImageUsage(action.config.image, action.id)
      }
      // Add new image usage
      if (value) {
        updateImageUsage(value, { type: "process", id: action.id, name: `${action.type} Action` })
      }
    }

    const updatedAction = {
      ...action,
      config: {
        ...action.config,
        [key]: value,
      },
    }
    onUpdateAction(updatedAction)
  }

  return (
    <div className="space-y-4">
      <Card className="border-gray-700 bg-[#27272A]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-[#00D9FF]">{action.type} Properties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{renderActionProperties(action, updateConfig, images, states, processes)}</CardContent>
      </Card>
    </div>
  )
}

function renderActionProperties(action: Action, updateConfig: (key: string, value: any) => void, images: any[], states: any[], processes: any[]) {
  switch (action.type) {
    case "FIND":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Image</Label>
            <ImageSelector
              selectedImage={action.config.image || null}
              onSelectImage={(imageId) => updateConfig("image", imageId)}
              images={images}
              placeholder="Select image to find"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Similarity Threshold</Label>
            <Input
              type="number"
              min="0.7"
              max="1.0"
              step="0.1"
              value={action.config.similarity}
              onChange={(e) => updateConfig("similarity", Number.parseFloat(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Search Strategy</Label>
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
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "CLICK":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Target</Label>
            <Select value={action.config.target} onValueChange={(value) => updateConfig("target", value)}>
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                <SelectItem value="Last Find Result">Last Find Result</SelectItem>
                <SelectItem value="Coordinates">Coordinates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Click Type</Label>
            <Select value={action.config.clickType} onValueChange={(value) => updateConfig("clickType", value)}>
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                <SelectItem value="left">Left Click</SelectItem>
                <SelectItem value="right">Right Click</SelectItem>
                <SelectItem value="middle">Middle Click</SelectItem>
                <SelectItem value="double">Double Click</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Click Count</Label>
            <Input
              type="number"
              min="1"
              value={action.config.clickCount}
              onChange={(e) => updateConfig("clickCount", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Hold Duration (ms)</Label>
            <Input
              type="number"
              min="0"
              value={action.config.hold_duration}
              onChange={(e) => updateConfig("hold_duration", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "DRAG":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">From</Label>
            <Select value={action.config.from} onValueChange={(value) => updateConfig("from", value)}>
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                <SelectItem value="Last Find Result">Last Find Result</SelectItem>
                <SelectItem value="Coordinates">Coordinates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">To (Image)</Label>
            <ImageSelector
              selectedImage={action.config.to || null}
              onSelectImage={(imageId) => updateConfig("to", imageId)}
              images={images}
              placeholder="Select target image"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Drag Duration (ms)</Label>
            <Input
              type="number"
              min="0"
              value={action.config.drag_duration}
              onChange={(e) => updateConfig("drag_duration", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="smooth_movement"
              checked={action.config.smooth_movement}
              onCheckedChange={(checked) => updateConfig("smooth_movement", checked)}
            />
            <Label htmlFor="smooth_movement" className="text-xs text-gray-400">
              Smooth movement
            </Label>
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "VANISH":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Image to Wait For</Label>
            <ImageSelector
              selectedImage={action.config.image || null}
              onSelectImage={(imageId) => updateConfig("image", imageId)}
              images={images}
              placeholder="Select image to wait for disappearance"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Timeout (ms)</Label>
            <Input
              type="number"
              min="0"
              value={action.config.timeout}
              onChange={(e) => updateConfig("timeout", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Check Interval (ms)</Label>
            <Input
              type="number"
              min="0"
              value={action.config.check_interval}
              onChange={(e) => updateConfig("check_interval", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "TYPE":
      const textAreaRef = useRef<HTMLTextAreaElement>(null)
      return (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-400">Text to Type</Label>
              <SpecialKeysSelector 
                onInsertKey={(newText) => updateConfig("text", newText)}
                textAreaRef={textAreaRef}
              />
            </div>
            <Textarea
              ref={textAreaRef}
              value={action.config.text}
              onChange={(e) => updateConfig("text", e.target.value)}
              className="bg-transparent border-gray-700 font-mono text-sm"
              placeholder="Enter text to type..."
              rows={4}
            />
            {action.config.text && (
              <div className="p-2 bg-gray-800/50 rounded-md border border-gray-700">
                <div className="text-xs text-gray-500 mb-1">Preview:</div>
                <div className="text-sm font-mono text-gray-300 break-all">
                  <SpecialKeyDisplay text={action.config.text} />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Typing Delay (ms)</Label>
            <Input
              type="number"
              min="0"
              value={action.config.typing_delay}
              onChange={(e) => updateConfig("typing_delay", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="clear_before"
              checked={action.config.clear_before}
              onCheckedChange={(checked) => updateConfig("clear_before", checked)}
            />
            <Label htmlFor="clear_before" className="text-xs text-gray-400">
              Clear before typing
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="press_enter"
              checked={action.config.press_enter}
              onCheckedChange={(checked) => {
                updateConfig("press_enter", checked)
                // If enabling press_enter and text doesn't end with {ENTER}, add it
                // If disabling press_enter and text ends with {ENTER}, remove it
                const currentText = action.config.text || ""
                if (checked && !currentText.endsWith("{ENTER}")) {
                  updateConfig("text", currentText + "{ENTER}")
                } else if (!checked && currentText.endsWith("{ENTER}")) {
                  updateConfig("text", currentText.slice(0, -7)) // Remove "{ENTER}" (7 chars)
                }
              }}
            />
            <Label htmlFor="press_enter" className="text-xs text-gray-400">
              Press Enter after typing
            </Label>
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "SCROLL":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Direction</Label>
            <Select value={action.config.direction} onValueChange={(value) => updateConfig("direction", value)}>
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                <SelectItem value="up">Up</SelectItem>
                <SelectItem value="down">Down</SelectItem>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Amount (scroll units)</Label>
            <Input
              type="number"
              min="1"
              value={action.config.amount}
              onChange={(e) => updateConfig("amount", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Scroll Duration (ms)</Label>
            <Input
              type="number"
              min="0"
              value={action.config.scroll_duration}
              onChange={(e) => updateConfig("scroll_duration", Number.parseInt(e.target.value))}
              className="bg-transparent border-gray-700"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="smooth_scroll"
              checked={action.config.smooth_scroll}
              onCheckedChange={(checked) => updateConfig("smooth_scroll", checked)}
            />
            <Label htmlFor="smooth_scroll" className="text-xs text-gray-400">
              Smooth scroll
            </Label>
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "GO_TO_STATE":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Target State</Label>
            <Select value={action.config.state || ""} onValueChange={(value) => updateConfig("state", value)}>
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue placeholder="Select a state" />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                {states.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name || state.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "RUN_PROCESS":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Process to Run</Label>
            <Select value={action.config.process || ""} onValueChange={(value) => updateConfig("process", value)}>
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue placeholder="Select a process" />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                {processes.map((process) => (
                  <SelectItem key={process.id} value={process.id}>
                    {process.name || process.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    default:
      return <p className="text-sm text-gray-500">Properties for {action.type} action</p>
  }
}

function renderTimingProperties(action: Action, updateConfig: (key: string, value: any) => void) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Pause Before Begin (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.pause_before_begin}
          onChange={(e) => updateConfig("pause_before_begin", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Pause After End (ms)</Label>
        <Input
          type="number"
          min="0"
          value={action.config.pause_after_end}
          onChange={(e) => updateConfig("pause_after_end", Number.parseInt(e.target.value))}
          className="bg-transparent border-gray-700"
        />
      </div>
    </>
  )
}
