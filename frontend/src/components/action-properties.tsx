"use client"

import { useRef, useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Settings, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ImageSelector } from "@/components/image-selector"
import { SpecialKeysSelector, SpecialKeyDisplay } from "@/components/special-keys-selector"
import { useAutomation } from "@/contexts/automation-context"

interface Action {
  id: string
  type: "FIND" | "FIND_STATE_IMAGE" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH" | "GO_TO_STATE" | "RUN_PROCESS"
  config: Record<string, any>
}

interface ActionPropertiesProps {
  action: Action | null
  onUpdateAction: (action: Action) => void
}

export function ActionProperties({ action, onUpdateAction }: ActionPropertiesProps) {
  const { images, updateImageUsage, removeImageUsage, states, processes } = useAutomation()
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const [shouldOpenImageSelector, setShouldOpenImageSelector] = useState(false)

  // Detect when a new FIND action is selected without an image
  useEffect(() => {
    if (action && action.type === "FIND" && !action.config.image) {
      setShouldOpenImageSelector(true)
    } else {
      setShouldOpenImageSelector(false)
    }
  }, [action?.id, action?.type])

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

  const updateConfig = (key: string, value: any, additionalUpdates: Record<string, any> = {}) => {
    // Special case: reset entire config to new value
    if (key === "__reset__") {
      const updatedAction = {
        ...action,
        config: value
      }
      onUpdateAction(updatedAction)
      return
    }

    if (key === "image") {
      // Remove old image usage
      if (action.config.image) {
        removeImageUsage(action.config.image, action.id)
      }
      // Add new image usage
      if (value) {
        updateImageUsage(value, { type: "process", id: action.id, name: `${action.type} Action` })
      }
      // Clear removedImage marker when selecting a new image
      if (action.config.removedImage) {
        additionalUpdates.removedImage = undefined
      }
    }

    const updatedAction = {
      ...action,
      config: {
        ...action.config,
        [key]: value,
        ...additionalUpdates  // Merge any additional config updates
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
        <CardContent className="space-y-4">{renderActionProperties(action, updateConfig, images, states, processes, textAreaRef, shouldOpenImageSelector)}</CardContent>
      </Card>
    </div>
  )
}

function renderActionProperties(action: Action, updateConfig: (key: string, value: any) => void, images: any[], states: any[], processes: any[], textAreaRef: React.RefObject<HTMLTextAreaElement>, shouldOpenImageSelector?: boolean) {
  switch (action.type) {
    case "FIND":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Image</Label>
            {action.config.removedImage && (
              <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                <span className="font-medium">Removed Image:</span> {action.config.removedImage}
                <p className="text-xs text-red-400 mt-1">
                  This image was deleted. Please select a new image.
                </p>
              </div>
            )}
            <ImageSelector
              selectedImage={action.config.image || null}
              onSelectImage={(imageId) => updateConfig("image", imageId)}
              images={images}
              states={states}
              placeholder="Select image to find"
              showStateFilter={true}
              initialOpen={shouldOpenImageSelector}
            />
          </div>

          {/* Similarity Threshold Override */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-400">Similarity Threshold Override</Label>
              {action.config.similarity !== undefined ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
                  onClick={() => {
                    const { similarity, ...rest } = action.config
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
            {action.config.similarity !== undefined && (
              <>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[action.config.similarity * 100]}
                  onValueChange={(values) => updateConfig("similarity", values[0] / 100)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>70%</span>
                  <span className="text-gray-400">{(action.config.similarity * 100).toFixed(0)}%</span>
                  <span>100%</span>
                </div>
              </>
            )}
            {action.config.similarity === undefined && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
                onClick={() => updateConfig("similarity", 0.85)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Set Override
              </Button>
            )}
          </div>

          {/* Search Strategy Override */}
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

          {renderTimingProperties(action, updateConfig)}
        </>
      )

    case "FIND_STATE_IMAGE":
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Select State</Label>
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
            {action.config.state && (
              <div className="text-xs text-gray-400 mt-2">
                {(() => {
                  const selectedState = states.find(s => s.id === action.config.state)
                  if (selectedState && selectedState.stateImages?.length > 0) {
                    return `Will find any of ${selectedState.stateImages.length} image${selectedState.stateImages.length > 1 ? 's' : ''} from ${selectedState.name}`
                  }
                  return selectedState ? `No images defined for ${selectedState.name}` : 'State not found'
                })()}
              </div>
            )}
          </div>

          {/* Similarity Threshold Override */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-400">Similarity Threshold Override</Label>
              {action.config.similarity !== undefined ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
                  onClick={() => {
                    const { similarity, ...rest } = action.config
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
            {action.config.similarity !== undefined && (
              <>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[action.config.similarity * 100]}
                  onValueChange={(values) => updateConfig("similarity", values[0] / 100)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>70%</span>
                  <span className="text-gray-400">{(action.config.similarity * 100).toFixed(0)}%</span>
                  <span>100%</span>
                </div>
              </>
            )}
            {action.config.similarity === undefined && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
                onClick={() => updateConfig("similarity", 0.85)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Set Override
              </Button>
            )}
          </div>

          {/* Search Strategy Override */}
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
            {action.config.removedImageTo && (
              <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                <span className="font-medium">Removed Image:</span> {action.config.removedImageTo}
                <p className="text-xs text-red-400 mt-1">
                  This image was deleted. Please select a new target image.
                </p>
              </div>
            )}
            <ImageSelector
              selectedImage={action.config.to || null}
              onSelectImage={(imageId) => {
                updateConfig("to", imageId)
                // Clear the removedImageTo marker when selecting a new image
                if (action.config.removedImageTo) {
                  const updatedAction = {
                    ...action,
                    config: {
                      ...action.config,
                      to: imageId,
                      removedImageTo: undefined
                    }
                  }
                  onUpdateAction(updatedAction)
                }
              }}
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
            {action.config.removedImage && (
              <div className="mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                <span className="font-medium">Removed Image:</span> {action.config.removedImage}
                <p className="text-xs text-red-400 mt-1">
                  This image was deleted. Please select a new image.
                </p>
              </div>
            )}
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
      return (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Text Source</Label>
            <Select
              value={action.config.textSource || "stateString"}
              onValueChange={(value) => {
                updateConfig("textSource", value)
                // If switching to stateString and no state selected, try to select the first available state
                if (value === "stateString" && !action.config.selectedState) {
                  const statesWithStrings = states.filter(s => s.strings && s.strings.length > 0)
                  if (statesWithStrings.length > 0) {
                    updateConfig("selectedState", statesWithStrings[0].id)
                  }
                }
              }}
            >
              <SelectTrigger className="bg-transparent border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#27272A] border-gray-700">
                <SelectItem value="stateString">State String</SelectItem>
                <SelectItem value="manual">Manual Text</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action.config.textSource === "stateString" ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs text-gray-400">Select State</Label>
                <Select
                  value={action.config.selectedState || "none"}
                  onValueChange={(value) => {
                    const stateValue = value === "none" ? null : value
                    // Update both selectedState and selectedStateStrings in one call
                    updateConfig("selectedState", stateValue, { selectedStateStrings: [] })
                  }}
                >
                  <SelectTrigger className="bg-transparent border-gray-700">
                    <SelectValue placeholder="Select a state" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#27272A] border-gray-700">
                    {states.filter(s => s.strings && s.strings.length > 0).length === 0 ? (
                      <SelectItem value="none" disabled>
                        No states with strings defined
                      </SelectItem>
                    ) : (
                      <>
                        <SelectItem value="none">Select a state...</SelectItem>
                        {states.filter(s => s.strings && s.strings.length > 0).map((state) => (
                          <SelectItem key={state.id} value={state.id}>
                            {state.name || state.id} ({state.strings.length} string{state.strings.length !== 1 ? 's' : ''})
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {action.config.selectedState && (() => {
                const selectedState = states.find(s => s.id === action.config.selectedState)
                if (!selectedState || !selectedState.strings || selectedState.strings.length === 0) {
                  return (
                    <div className="text-xs text-gray-500 p-2 bg-gray-800/50 rounded">
                      No strings defined in this state
                    </div>
                  )
                }

                return (
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-400">Select Strings</Label>
                    <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-gray-800/50 rounded border border-gray-700">
                      {selectedState.strings.map((str, index) => (
                        <div key={str.id} className="flex items-start space-x-2">
                          <Checkbox
                            id={`string-${str.id}`}
                            checked={action.config.selectedStateStrings?.includes(str.id) || false}
                            onCheckedChange={(checked) => {
                              const current = action.config.selectedStateStrings || []
                              if (checked) {
                                updateConfig("selectedStateStrings", [...current, str.id])
                              } else {
                                updateConfig("selectedStateStrings", current.filter(id => id !== str.id))
                              }
                            }}
                          />
                          <div className="flex-1">
                            <Label htmlFor={`string-${str.id}`} className="text-xs text-gray-400">
                              {index + 1}. {str.name || "Unnamed"}
                            </Label>
                            <div className="text-xs text-gray-500 font-mono mt-1 break-all">
                              "{str.value}"
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </>
          ) : (
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
          )}

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
