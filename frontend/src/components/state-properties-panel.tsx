"use client"

import React, { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, Trash2, Map, MapPin, Type, Image as ImageIcon } from "lucide-react"
import { ImageSelector } from "@/components/image-selector"
import { SpecialKeysSelector, SpecialKeyDisplay } from "@/components/special-keys-selector"

interface StateRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

interface StateLocation {
  id: string
  name: string
  x: number
  y: number
}

interface StateString {
  id: string
  name: string
  value: string
}

interface State {
  id: string
  name: string
  description: string
  initial?: boolean
  identifyingImages: Array<{ image: string }>
  regions: StateRegion[]
  locations: StateLocation[]
  strings: StateString[]
  position: { x: number; y: number }
}

interface StatePropertiesPanelProps {
  state: State
  images: any[]
  updateState: (updates: Partial<State>) => void
  addIdentifyingImage: () => void
  updateIdentifyingImage: (index: number, field: "image", value: any) => void
  removeIdentifyingImage: (index: number) => void
  addRegion: () => void
  updateRegion: (index: number, field: keyof StateRegion, value: any) => void
  removeRegion: (index: number) => void
  addLocation: () => void
  updateLocation: (index: number, field: keyof StateLocation, value: any) => void
  removeLocation: (index: number) => void
  addString: () => void
  updateString: (index: number, field: keyof StateString, value: any) => void
  removeString: (index: number) => void
}

export function StatePropertiesPanel({
  state,
  images,
  updateState,
  addIdentifyingImage,
  updateIdentifyingImage,
  removeIdentifyingImage,
  addRegion,
  updateRegion,
  removeRegion,
  addLocation,
  updateLocation,
  removeLocation,
  addString,
  updateString,
  removeString,
}: StatePropertiesPanelProps) {
  const [newImageIndex, setNewImageIndex] = useState<number | null>(null)
  const stringTextAreaRefs = useRef<{ [key: string]: HTMLTextAreaElement | null }>({})

  // Function to set a ref for a specific string's textarea
  const setStringTextAreaRef = (stringId: string) => (el: HTMLTextAreaElement | null) => {
    stringTextAreaRefs.current[stringId] = el
  }

  // Track when a new image is added
  useEffect(() => {
    if (newImageIndex !== null && state.identifyingImages[newImageIndex]?.image === "") {
      // Reset after a short delay to allow the ImageSelector to open
      setTimeout(() => setNewImageIndex(null), 100)
    }
  }, [newImageIndex, state.identifyingImages])

  const handleAddIdentifyingImage = () => {
    const newIndex = state.identifyingImages.length
    setNewImageIndex(newIndex)
    addIdentifyingImage()
  }

  return (
    <Card className="border-gray-700 bg-[#27272A] h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-sm font-medium text-[#00D9FF]">State Properties</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden p-6">
        <div className="space-y-2 flex-shrink-0">
          <Label className="text-xs text-gray-400">State Name</Label>
          <Input
            value={state.name}
            onChange={(e) => updateState({ name: e.target.value })}
            className="bg-transparent border-gray-700"
          />
        </div>

        <div className="space-y-2 flex-shrink-0">
          <Label className="text-xs text-gray-400">Description</Label>
          <Textarea
            value={state.description}
            onChange={(e) => updateState({ description: e.target.value })}
            className="bg-transparent border-gray-700"
            rows={2}
          />
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <Checkbox
            id="initial-state"
            checked={state.initial || false}
            onCheckedChange={(checked) => updateState({ initial: checked as boolean })}
            className="border-gray-600 data-[state=checked]:bg-[#00D9FF] data-[state=checked]:border-[#00D9FF]"
          />
          <Label htmlFor="initial-state" className="text-xs text-gray-400 cursor-pointer">
            Initial State (Expected at start)
          </Label>
        </div>

        <Tabs defaultValue="images" className="flex-1 flex flex-col min-h-0 border border-gray-700 rounded-lg bg-[#1A1A1B] overflow-hidden">
          <TabsList className="grid w-full grid-cols-4 h-10 bg-[#1A1A1B] border-b border-gray-700 p-1 rounded-none">
            <TabsTrigger
              value="images"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#00D9FF]/20 data-[state=active]:text-[#00D9FF] data-[state=active]:border data-[state=active]:border-[#00D9FF]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <ImageIcon className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="regions"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#BD00FF]/20 data-[state=active]:text-[#BD00FF] data-[state=active]:border data-[state=active]:border-[#BD00FF]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <Map className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="locations"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#00FF88]/20 data-[state=active]:text-[#00FF88] data-[state=active]:border data-[state=active]:border-[#00FF88]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <MapPin className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="strings"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#FFD700]/20 data-[state=active]:text-[#FFD700] data-[state=active]:border data-[state=active]:border-[#FFD700]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <Type className="w-4 h-4" />
            </TabsTrigger>
          </TabsList>

          {/* Images Tab */}
          <TabsContent value="images" className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Images</Label>
              <Button variant="ghost" size="sm" onClick={handleAddIdentifyingImage} className="text-gray-400 hover:text-gray-300">
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            {state.identifyingImages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">No images configured</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.identifyingImages.map((imgConfig, index) => (
                  <div key={index} className="space-y-2 p-2 bg-gray-800/50 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ImageSelector
                          selectedImage={imgConfig.image || null}
                          onSelectImage={(imageId) => updateIdentifyingImage(index, "image", imageId)}
                          images={images}
                          placeholder="Select image"
                          initialOpen={newImageIndex === index}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                        onClick={() => removeIdentifyingImage(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Regions Tab */}
          <TabsContent value="regions" className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Regions</Label>
              <Button variant="ghost" size="sm" onClick={addRegion} className="text-gray-400 hover:text-gray-300">
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            {state.regions?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">No regions defined</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.regions?.map((region, index) => (
                  <div key={region.id} className="space-y-2 p-2 bg-gray-800/50 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <Input
                        value={region.name}
                        onChange={(e) => updateRegion(index, "name", e.target.value)}
                        className="flex-1 h-7 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        placeholder="Region name"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                        onClick={() => removeRegion(index)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-gray-300">X:</Label>
                        <Input
                          type="number"
                          value={region.x}
                          onChange={(e) => updateRegion(index, "x", parseInt(e.target.value))}
                          className="h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-gray-300">Y:</Label>
                        <Input
                          type="number"
                          value={region.y}
                          onChange={(e) => updateRegion(index, "y", parseInt(e.target.value))}
                          className="h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-gray-300">W:</Label>
                        <Input
                          type="number"
                          value={region.width}
                          onChange={(e) => updateRegion(index, "width", parseInt(e.target.value))}
                          className="h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-gray-300">H:</Label>
                        <Input
                          type="number"
                          value={region.height}
                          onChange={(e) => updateRegion(index, "height", parseInt(e.target.value))}
                          className="h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Locations Tab */}
          <TabsContent value="locations" className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Locations</Label>
              <Button variant="ghost" size="sm" onClick={addLocation} className="text-gray-400 hover:text-gray-300">
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            {state.locations?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">No locations defined</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.locations?.map((location, index) => (
                  <div key={location.id} className="space-y-2 p-2 bg-gray-800/50 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <Input
                        value={location.name}
                        onChange={(e) => updateLocation(index, "name", e.target.value)}
                        className="flex-1 h-7 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        placeholder="Location name"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                        onClick={() => removeLocation(index)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-gray-300">X:</Label>
                        <Input
                          type="number"
                          value={location.x}
                          onChange={(e) => updateLocation(index, "x", parseInt(e.target.value))}
                          className="h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-gray-300">Y:</Label>
                        <Input
                          type="number"
                          value={location.y}
                          onChange={(e) => updateLocation(index, "y", parseInt(e.target.value))}
                          className="h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Strings Tab */}
          <TabsContent value="strings" className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Strings</Label>
              <Button variant="ghost" size="sm" onClick={addString} className="text-gray-400 hover:text-gray-300">
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            {state.strings?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">No strings defined</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.strings?.map((string, index) => (
                  <div key={string.id} className="space-y-2 p-2 bg-gray-800/50 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <Input
                        value={string.name}
                        onChange={(e) => updateString(index, "name", e.target.value)}
                        className="flex-1 h-7 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                        placeholder="String name"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                        onClick={() => removeString(index)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-gray-400">Value</Label>
                        <SpecialKeysSelector
                          onInsertKey={(newText) => updateString(index, "value", newText)}
                          textAreaRef={{ current: stringTextAreaRefs.current[string.id] }}
                        />
                      </div>
                      <Textarea
                        ref={setStringTextAreaRef(string.id)}
                        value={string.value}
                        onChange={(e) => updateString(index, "value", e.target.value)}
                        className="w-full min-h-[60px] bg-gray-900 border-gray-600 text-gray-200 text-xs font-mono"
                        placeholder="String value"
                        rows={2}
                      />
                      {string.value && (
                        <div className="p-2 bg-gray-900/50 rounded-md border border-gray-700">
                          <div className="text-xs text-gray-500 mb-1">Preview:</div>
                          <div className="text-xs font-mono text-gray-300 break-all">
                            <SpecialKeyDisplay text={string.value} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
