"use client"

import type React from "react"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { MaskEditor } from "@/components/mask-editor"
import { Upload, ImageIcon, Trash2, Search, X, Edit } from "lucide-react"
import { toast } from "sonner"
import { useAutomation } from "@/contexts/automation-context"
import { ImageDeletionDialog, type ImageUsageInfo } from "@/components/image-deletion-dialog"

interface ImageAsset {
  id: string
  name: string
  url: string
  size: number
  createdAt: Date
  usageCount: number
  usedIn: Array<{ type: "process" | "state"; id: string; name: string }>
  source: 'uploaded' | 'pattern_optimization' | 'image_extraction' | 'state_discovery'
}

export function ImagesManager() {
  const {
    images,
    addImage,
    deleteImage,
    updateImage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses
  } = useAutomation()
  const [searchQuery, setSearchQuery] = useState("")
  const [dragActive, setDragActive] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [showMaskEditor, setShowMaskEditor] = useState(false)
  const [editingImage, setEditingImage] = useState<ImageAsset | null>(null)
  const [showDeletionDialog, setShowDeletionDialog] = useState(false)
  const [imageToDelete, setImageToDelete] = useState<ImageAsset | null>(null)
  const [deletionUsageInfo, setDeletionUsageInfo] = useState<ImageUsageInfo>({ states: [], processes: [] })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Count images by source
  const imageCounts = {
    all: images.length,
    uploaded: images.filter(img => img.source === 'uploaded').length,
    pattern_optimization: images.filter(img => img.source === 'pattern_optimization').length,
    image_extraction: images.filter(img => img.source === 'image_extraction').length,
    state_discovery: images.filter(img => img.source === 'state_discovery').length,
  }

  // Filter images by search query and source
  const filteredImages = images.filter((image) => {
    const matchesSearch = image.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesSource = !activeFilter || image.source === activeFilter
    return matchesSearch && matchesSource
  })

  const handleFiles = useCallback(
    (files: FileList) => {
      const newImages: ImageAsset[] = []
      let processedFiles = 0
      const totalFiles = files.length

      Array.from(files).forEach((file) => {
        if (!file.type.startsWith("image/")) {
          toast.error("Invalid file type", {
            description: `${file.name} is not an image file.`,
          })
          processedFiles++
          if (processedFiles === totalFiles && newImages.length > 0) {
            newImages.forEach(image => addImage(image))
            toast.success("Images uploaded", {
              description: `${newImages.length} image(s) added to your library.`,
            })
          }
          return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
          const img = new Image()
          img.onload = () => {
            // Validate image dimensions
            if (img.width < 10 || img.height < 10) {
              toast.error("Image too small", {
                description: `${file.name} is ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`,
              })
              processedFiles++
              if (processedFiles === totalFiles && newImages.length > 0) {
                newImages.forEach(image => addImage(image))
                toast.success("Images uploaded", {
                  description: `${newImages.length} image(s) added to your library.`,
                })
              }
              return
            }

            const newImage: ImageAsset = {
              id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: file.name,
              url: e.target?.result as string,
              size: file.size,
              createdAt: new Date(),
              usageCount: 0,
              usedIn: [],
              source: 'uploaded',
            }

            newImages.push(newImage)
            processedFiles++

            if (processedFiles === totalFiles && newImages.length > 0) {
              newImages.forEach(image => addImage(image))
              toast.success("Images uploaded", {
                description: `${newImages.length} image(s) added to your library.`,
              })
            }
          }
          img.onerror = () => {
            toast.error("Failed to load image", {
              description: `${file.name} could not be processed.`,
            })
            processedFiles++
            if (processedFiles === totalFiles && newImages.length > 0) {
              newImages.forEach(image => addImage(image))
              toast.success("Images uploaded", {
                description: `${newImages.length} image(s) added to your library.`,
              })
            }
          }
          img.src = e.target?.result as string
        }
        reader.readAsDataURL(file)
      })
    },
    [addImage],
  )

  const handleDeleteImage = (imageId: string) => {
    const image = images.find(img => img.id === imageId)
    if (!image) {
      toast.error("Image not found")
      return
    }

    // Get usage information
    const usageInfo = getImageUsage(imageId)
    setImageToDelete(image)
    setDeletionUsageInfo(usageInfo)
    setShowDeletionDialog(true)
  }

  const confirmDelete = async () => {
    if (!imageToDelete) return

    try {
      // Perform cascade deletion
      const statesAffected = await removeImageFromStates(imageToDelete.url)
      const processesAffected = await markImageAsRemovedInProcesses(imageToDelete.id, imageToDelete.name)

      // Delete the image from the library
      deleteImage(imageToDelete.id)

      // Show success message
      const details = []
      if (statesAffected > 0) {
        details.push(`Removed from ${statesAffected} state${statesAffected > 1 ? 's' : ''}`)
      }
      if (processesAffected > 0) {
        details.push(`Marked as removed in ${processesAffected} workflow${processesAffected > 1 ? 's' : ''}`)
      }

      toast.success("Image deleted", {
        description: details.length > 0
          ? details.join(' and ')
          : "The image has been removed from your library.",
      })

      // Reset state
      setImageToDelete(null)
      setDeletionUsageInfo({ states: [], processes: [] })
    } catch (error) {
      toast.error("Failed to delete image", {
        description: "An error occurred while deleting the image.",
      })
      console.error('Delete image error:', error)
    }
  }

  const handleEditMask = (image: ImageAsset) => {
    setEditingImage(image)
    setShowMaskEditor(true)
  }

  const handleSaveMask = (maskedImage: string, mask: string) => {
    if (!editingImage) return

    const updatedImage: ImageAsset = {
      ...editingImage,
      url: maskedImage,
      mask: mask, // Store the separate mask image
    }

    updateImage(updatedImage)
    setShowMaskEditor(false)
    setEditingImage(null)
    toast.success("Mask applied to image", {
      description: "The image has been updated with the new mask.",
    })
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

  const getSourceLabel = (source: string) => {
    switch(source) {
      case 'uploaded': return 'Uploaded'
      case 'pattern_optimization': return 'Pattern Opt'
      case 'image_extraction': return 'Extraction'
      case 'state_discovery': return 'Discovery'
      default: return 'Unknown'
    }
  }

  const getSourceColor = (source: string) => {
    switch(source) {
      case 'uploaded': return '#00FF88'
      case 'pattern_optimization': return '#00D9FF'
      case 'image_extraction': return '#BD00FF'
      case 'state_discovery': return '#FFB800'
      default: return '#6B7280'
    }
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">Library</h2>

          {/* Stats - moved next to title */}
          {images.length > 0 && (
            <div className="flex gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#27272A]/50 border border-gray-700 rounded-lg">
                <span className="text-xs text-gray-400">Total Images:</span>
                <span className="text-sm font-bold text-[#00FF88]">{images.length}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#27272A]/50 border border-gray-700 rounded-lg">
                <span className="text-xs text-gray-400">Total Usage:</span>
                <span className="text-sm font-bold text-[#00D9FF]">
                  {images.reduce((acc, img) => acc + img.usageCount, 0)}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#27272A]/50 border border-gray-700 rounded-lg">
                <span className="text-xs text-gray-400">Total Size:</span>
                <span className="text-sm font-bold text-[#BD00FF]">
                  {formatFileSize(images.reduce((acc, img) => acc + img.size, 0))}
                </span>
              </div>
            </div>
          )}
        </div>

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

      {/* Source Filter Badges */}
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={activeFilter === null ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === null
                ? "bg-[#00FF88] text-black border-[#00FF88]"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
            onClick={() => setActiveFilter(null)}
          >
            All ({imageCounts.all})
          </Badge>
          <Badge
            variant={activeFilter === 'uploaded' ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === 'uploaded'
                ? "bg-[#00FF88] text-black border-[#00FF88]"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
            onClick={() => setActiveFilter('uploaded')}
          >
            Uploaded ({imageCounts.uploaded})
          </Badge>
          <Badge
            variant={activeFilter === 'pattern_optimization' ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === 'pattern_optimization'
                ? "bg-[#00D9FF] text-black border-[#00D9FF]"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
            onClick={() => setActiveFilter('pattern_optimization')}
          >
            Pattern Opt ({imageCounts.pattern_optimization})
          </Badge>
          <Badge
            variant={activeFilter === 'image_extraction' ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === 'image_extraction'
                ? "bg-[#BD00FF] text-black border-[#BD00FF]"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
            onClick={() => setActiveFilter('image_extraction')}
          >
            Extraction ({imageCounts.image_extraction})
          </Badge>
          <Badge
            variant={activeFilter === 'state_discovery' ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === 'state_discovery'
                ? "bg-[#FFB800] text-black border-[#FFB800]"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-600"
            }`}
            onClick={() => setActiveFilter('state_discovery')}
          >
            Discovery ({imageCounts.state_discovery})
          </Badge>
        </div>
      )}

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
              <p className="text-sm">Upload images to use in your automation workflows</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-6 md:grid-cols-8 lg:grid-cols-12 xl:grid-cols-16 gap-2">
          {filteredImages.map((image) => (
            <Card key={image.id} className="border-gray-700 bg-[#27272A] hover:border-gray-600 transition-colors group">
              <CardContent className="p-1">
                <div className="space-y-1">
                  {/* Image Preview - reduced by 50% */}
                  <div className="aspect-square bg-gray-800 rounded overflow-hidden relative w-20 h-20">
                    <img
                      src={image.url || "/placeholder.svg"}
                      alt={image.name}
                      className="w-full h-full object-contain p-0.5"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-purple-400 hover:text-purple-300 hover:bg-purple-400/20 h-6 w-6 p-0"
                        onClick={() => handleEditMask(image)}
                        title="Edit Mask"
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/20 h-6 w-6 p-0"
                        onClick={() => handleDeleteImage(image.id)}
                        title="Delete Image"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Image Info - adjusted for smaller size */}
                  <div className="space-y-0.5">
                    <h4 className="font-medium text-[10px] truncate" title={image.name}>
                      {image.name}
                    </h4>

                    <div className="flex items-center justify-between text-[8px] text-gray-400">
                      <span>{formatFileSize(image.size)}</span>
                    </div>

                    <div className="flex items-center justify-between gap-0.5">
                      <Badge
                        variant={image.usageCount > 0 ? "default" : "secondary"}
                        className={`text-[8px] px-0.5 py-0 h-3 ${
                          image.usageCount > 0 ? "bg-[#00FF88] text-black" : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {image.usageCount}x
                      </Badge>
                      <Badge
                        className="text-[8px] px-0.5 py-0 h-3"
                        style={{
                          backgroundColor: getSourceColor(image.source),
                          color: 'black'
                        }}
                      >
                        {getSourceLabel(image.source)}
                      </Badge>
                    </div>

                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Mask Editor */}
      {showMaskEditor && editingImage && (
        <MaskEditor
          imageUrl={editingImage.url}
          imageName={editingImage.name}
          initialMask={editingImage.mask}
          onSave={handleSaveMask}
          onCancel={() => {
            setShowMaskEditor(false)
            setEditingImage(null)
          }}
          open={showMaskEditor}
        />
      )}

      {/* Image Deletion Dialog */}
      <ImageDeletionDialog
        open={showDeletionDialog}
        onOpenChange={setShowDeletionDialog}
        imageName={imageToDelete?.name || ""}
        usageInfo={deletionUsageInfo}
        onConfirmDelete={confirmDelete}
      />
    </div>
  )
}
