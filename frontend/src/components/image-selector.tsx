"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ImageIcon, Search, X } from "lucide-react"

interface ImageAsset {
  id: string
  name: string
  url: string
  size: number
  uploadedAt: Date
  usageCount: number
}

interface ImageSelectorProps {
  selectedImage: string | null
  onSelectImage: (imageId: string | null) => void
  images: ImageAsset[]
  placeholder?: string
}

export function ImageSelector({
  selectedImage,
  onSelectImage,
  images,
  placeholder = "Select image",
}: ImageSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const filteredImages = images.filter((image) => image.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const selectedImageData = selectedImage ? images.find((img) => img.id === selectedImage) : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start bg-transparent border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
        >
          {selectedImageData ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gray-800 rounded flex items-center justify-center flex-shrink-0">
                <img
                  src={selectedImageData.url || "/placeholder.svg"}
                  alt={selectedImageData.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <span className="truncate">{selectedImageData.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400">
              <ImageIcon className="w-4 h-4" />
              <span>{placeholder}</span>
            </div>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="bg-[#27272A] border-gray-700 max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-[#00D9FF]">Select Image</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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
              <div className="text-sm text-gray-400">
                Current: <span className="text-white">{selectedImageData?.name}</span>
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
                {filteredImages.map((image) => (
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
                          <Badge variant="secondary" className="text-xs w-full justify-center">
                            Used {image.usageCount}x
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
