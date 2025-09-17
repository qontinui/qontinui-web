"use client"

import type React from "react"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Upload, ImageIcon, Trash2, Search, X } from "lucide-react"
import { toast } from "sonner"
import { useAutomation } from "@/contexts/automation-context"

interface ImageAsset {
  id: string
  name: string
  url: string
  size: number
  uploadedAt: Date
  usageCount: number
  usedIn: Array<{ type: "process" | "state"; id: string; name: string }>
}

export function ImagesManager() {
  const { images, addImages, deleteImage } = useAutomation()
  const [searchQuery, setSearchQuery] = useState("")
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredImages = images.filter((image) => image.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const handleFiles = useCallback(
    (files: FileList) => {
      const newImages: ImageAsset[] = []

      Array.from(files).forEach((file) => {
        if (!file.type.startsWith("image/")) {
          toast.error("Invalid file type", {
            description: `${file.name} is not an image file.`,
          })
          return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
          const newImage: ImageAsset = {
            id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            url: e.target?.result as string,
            size: file.size,
            uploadedAt: new Date(),
            usageCount: 0,
            usedIn: [],
          }

          newImages.push(newImage)

          if (newImages.length === files.length) {
            addImages(newImages)
            toast.success("Images uploaded", {
              description: `${newImages.length} image(s) added to your library.`,
            })
          }
        }
        reader.readAsDataURL(file)
      })
    },
    [addImages],
  )

  const handleDeleteImage = (imageId: string) => {
    const success = deleteImage(imageId)
    if (!success) {
      toast.error("Cannot delete image", {
        description: "This image is currently being used in processes or states.",
      })
    } else {
      toast.success("Image deleted", {
        description: "The image has been removed from your library.",
      })
    }
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        handleFiles(e.target.files)
      }
    },
    [handleFiles],
  )

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Image Library</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search images..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64 bg-transparent border-gray-700 focus:border-[#00FF88]"
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
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Images
          </Button>
        </div>
      </div>

      {/* Upload Area */}
      <Card
        className={`border-2 border-dashed transition-colors ${
          dragActive ? "border-[#00FF88] bg-[#00FF88]/10" : "border-gray-700 bg-[#27272A]/50 hover:border-gray-600"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="p-12">
          <div className="text-center">
            <Upload className={`w-12 h-12 mx-auto mb-4 ${dragActive ? "text-[#00FF88]" : "text-gray-500"}`} />
            <p className="text-lg mb-2">Drag & drop images here</p>
            <p className="text-sm text-gray-400 mb-4">or click to browse files</p>
            <Button
              variant="outline"
              className="border-gray-600 bg-transparent hover:border-[#00FF88] hover:text-[#00FF88]"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Files
            </Button>
          </div>
        </CardContent>
      </Card>

      <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileInput} className="hidden" />

      {/* Stats */}
      {images.length > 0 && (
        <div className="flex gap-4">
          <Card className="border-gray-700 bg-[#27272A]/50">
            <CardContent className="p-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-[#00FF88]">{images.length}</div>
                <div className="text-sm text-gray-400">Total Images</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gray-700 bg-[#27272A]/50">
            <CardContent className="p-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-[#00D9FF]">
                  {images.reduce((acc, img) => acc + img.usageCount, 0)}
                </div>
                <div className="text-sm text-gray-400">Total Usage</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gray-700 bg-[#27272A]/50">
            <CardContent className="p-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-[#BD00FF]">
                  {formatFileSize(images.reduce((acc, img) => acc + img.size, 0))}
                </div>
                <div className="text-sm text-gray-400">Total Size</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Image Gallery */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {searchQuery ? (
            <>
              <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No images found</p>
              <p className="text-sm">Try adjusting your search query</p>
            </>
          ) : (
            <>
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No images uploaded</p>
              <p className="text-sm">Upload images to use in your automation processes</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {filteredImages.map((image) => (
            <Card key={image.id} className="border-gray-700 bg-[#27272A] hover:border-gray-600 transition-colors group">
              <CardContent className="p-2">
                <div className="space-y-2">
                  {/* Image Preview - reduced by 50% */}
                  <div className="aspect-square bg-gray-800 rounded overflow-hidden relative">
                    <img
                      src={image.url || "/placeholder.svg"}
                      alt={image.name}
                      className="w-full h-full object-contain p-1"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/20"
                        onClick={() => handleDeleteImage(image.id)}
                        disabled={image.usageCount > 0}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Image Info - adjusted for smaller size */}
                  <div className="space-y-1">
                    <h4 className="font-medium text-xs truncate" title={image.name}>
                      {image.name}
                    </h4>

                    <div className="flex items-center justify-between text-[10px] text-gray-400">
                      <span>{formatFileSize(image.size)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <Badge
                        variant={image.usageCount > 0 ? "default" : "secondary"}
                        className={`text-[10px] px-1 py-0 ${
                          image.usageCount > 0 ? "bg-[#00FF88] text-black" : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {image.usageCount}x
                      </Badge>
                    </div>

                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
