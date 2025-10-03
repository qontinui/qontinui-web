"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ImageIcon, Search, X, Filter } from "lucide-react"
import { useImageStats } from "@/hooks/use-image-stats"

interface ImageAsset {
  id: string
  name: string
  url: string
  size?: number
  uploadedAt?: Date
  usageCount?: number
}

interface StateImage {
  id: string
  name: string
  patterns?: Array<{ image: string }>
}

interface State {
  id: string
  name: string
  stateImages?: StateImage[]
}

interface ImageSelectorProps {
  selectedImage: string | null
  onSelectImage: (imageId: string | null) => void
  images: ImageAsset[]
  states?: State[]
  placeholder?: string
  initialOpen?: boolean
  showStateFilter?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

export function ImageSelector({
  selectedImage,
  onSelectImage,
  images,
  states = [],
  placeholder = "Select image",
  initialOpen = false,
  showStateFilter = false,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: ImageSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(initialOpen)

  // Use controlled open if provided, otherwise use internal state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = onOpenChange || setInternalOpen
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedStateFilter, setSelectedStateFilter] = useState<string>("all")

  // Get StateImages to display based on filter
  const getStateImages = (): ImageAsset[] => {
    if (!showStateFilter) {
      // If not using state filter, show all StateImages from all states
      return states.flatMap(state =>
        (state.stateImages || []).map(si => ({
          id: si.id,
          name: si.name,
          url: si.patterns?.[0]?.image || '', // Use first pattern's image as thumbnail
        }))
      )
    }

    if (selectedStateFilter === "all") {
      // "All Images" - show all StateImages from all states
      return states.flatMap(state =>
        (state.stateImages || []).map(si => ({
          id: si.id,
          name: si.name,
          url: si.patterns?.[0]?.image || '', // Use first pattern's image as thumbnail
        }))
      )
    }

    // Specific state selected - show only that state's StateImages
    const selectedState = states.find(s => s.id === selectedStateFilter)
    return selectedState
      ? (selectedState.stateImages || []).map(si => ({
          id: si.id,
          name: si.name,
          url: si.patterns?.[0]?.image || '', // Use first pattern's image as thumbnail
        }))
      : []
  }

  const availableImages = getStateImages()
  const filteredImages = availableImages.filter((image) => image.name.toLowerCase().includes(searchQuery.toLowerCase()))

  // Find which state contains a StateImage for badge display
  const findStateImageInStates = (imageId: string) => {
    for (const state of states) {
      const stateImage = state.stateImages?.find(si => si.id === imageId)
      if (stateImage) return stateImage
    }
    return null
  }

  // Check if selectedImage is base64 data or an ID
  const isBase64 = selectedImage && (selectedImage.startsWith('data:') || selectedImage.length > 100)

  // Look for selected image in StateImages first, then fall back to library
  const selectedStateImage = selectedImage && !isBase64 ? findStateImageInStates(selectedImage) : null
  const selectedImageData = selectedImage && !isBase64 && !selectedStateImage
    ? images.find((img) => img.id === selectedImage)
    : selectedStateImage
      ? {
          id: selectedStateImage.id || selectedImage,
          name: selectedStateImage.name,
          url: selectedStateImage.patterns?.[0]?.image || '',
        }
      : null

  const stats = useImageStats(isBase64 ? selectedImage : null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start bg-transparent border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
          >
            {selectedImageData || isBase64 ? (
              <div className="flex items-center gap-2 w-full">
                <div className="w-8 h-8 bg-gray-800 rounded flex items-center justify-center flex-shrink-0">
                  <img
                    src={isBase64 ? selectedImage : (selectedImageData?.url || "/placeholder.svg")}
                    alt={selectedImageData?.name || "Selected Image"}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                {selectedImageData ? (
                  <span className="truncate">{selectedImageData.name}</span>
                ) : stats && !stats.isLoading ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-gray-300">{stats.width}×{stats.height}</span>
                    {stats.transparencyPercent > 0 && (
                      <span className="text-[#00D9FF]">{stats.transparencyPercent}% trans</span>
                    )}
                  </div>
                ) : (
                  <span className="text-gray-400 text-xs">Loading...</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400">
                <ImageIcon className="w-4 h-4" />
                <span>{placeholder}</span>
              </div>
            )}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="bg-[#27272A] border-gray-700 max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-[#00D9FF]">Select Image</DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            Choose an image from your library
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* State Filter */}
          {showStateFilter && states.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <Select value={selectedStateFilter} onValueChange={setSelectedStateFilter}>
                <SelectTrigger className="w-48 bg-transparent border-gray-700">
                  <SelectValue placeholder="Filter by state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Images</SelectItem>
                  {states.map((state) => (
                    <SelectItem key={state.id} value={state.id}>
                      {state.name} ({state.stateImages?.length || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search images..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-transparent border-gray-700 focus:border-[#00D9FF]"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setSearchQuery("")}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* Clear Selection */}
          {selectedImage && (
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-400 flex items-center gap-2">
                <span>Current:</span>
                {selectedImageData ? (
                  <span className="text-white">{selectedImageData.name}</span>
                ) : isBase64 && stats && !stats.isLoading ? (
                  <span className="text-white font-mono">{stats.width}×{stats.height}{stats.transparencyPercent > 0 ? `, ${stats.transparencyPercent}% transparent` : ''}</span>
                ) : (
                  <span className="text-white">Loading...</span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onSelectImage(null)
                  setOpen(false)
                }}
                className="border-gray-600 text-gray-400 hover:text-white"
              >
                Clear Selection
              </Button>
            </div>
          )}

          {/* Image Grid */}
          <div className="max-h-96 overflow-y-auto">
            {filteredImages.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                {searchQuery ? (
                  <>
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No images found</p>
                    <p className="text-sm">Try adjusting your search query</p>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No images available</p>
                    <p className="text-sm">Upload images in the Images tab first</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                {filteredImages.map((image) => {
                  // Find the StateImage to get pattern count
                  const stateImage = findStateImageInStates(image.id)

                  return (
                    <Card
                      key={image.id}
                      className={`cursor-pointer transition-all ${
                        selectedImage === image.id
                          ? "border-[#00D9FF] bg-[#00D9FF]/10"
                          : "border-gray-700 bg-[#27272A] hover:border-gray-600"
                      }`}
                      onClick={() => {
                        onSelectImage(image.id)
                        setOpen(false)
                      }}
                    >
                      <CardContent className="p-3">
                        <div className="space-y-2">
                          <div className="aspect-square bg-gray-800 rounded overflow-hidden p-2">
                            <img
                              src={image.url || "/placeholder.svg"}
                              alt={image.name}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium truncate" title={image.name}>
                              {image.name}
                            </p>
                            {stateImage && stateImage.patterns && stateImage.patterns.length > 0 && (
                              <Badge variant="secondary" className="text-xs w-full justify-center">
                                {stateImage.patterns.length} {stateImage.patterns.length === 1 ? 'pattern' : 'patterns'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
