/**
 * Example usage of ImageWithRefresh and ImageUploadProgress components
 *
 * This file demonstrates how to use the new S3 image handling components.
 * DO NOT import this file in production code - it's for reference only.
 */

import { useState } from "react"
import { ImageWithRefresh } from "@/components/ImageWithRefresh"
import { ImageUploadProgress, UploadingImage } from "@/components/ImageUploadProgress"
import { ImageAsset } from "@/contexts/automation-context/types"

// Example 1: Using ImageWithRefresh
function ExampleImageWithRefresh() {
  const [imageAsset, setImageAsset] = useState<ImageAsset>({
    id: "img-123",
    name: "example-image.png",
    url: "https://s3.amazonaws.com/bucket/key?signature=...",
    s3_key: "projects/123/images/example-image.png",
    url_expires_at: new Date(Date.now() + 3600000), // Expires in 1 hour
    size: 150000,
    createdAt: new Date(),
    usageCount: 5,
    source: "uploaded",
  })

  const handleRefresh = (newUrl: string) => {
    console.log("URL refreshed:", newUrl)
    // Update the imageAsset in your state/context
    setImageAsset(prev => ({
      ...prev,
      url: newUrl,
      url_expires_at: new Date(Date.now() + 3600000), // New expiry time
    }))
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Image with Auto-Refresh</h2>
      <ImageWithRefresh
        imageAsset={imageAsset}
        projectId={123}
        alt="Example image"
        className="max-w-full max-h-64 object-contain"
        onRefresh={handleRefresh}
      />
    </div>
  )
}

// Example 2: Using ImageUploadProgress
function ExampleImageUploadProgress() {
  const [uploads, setUploads] = useState<UploadingImage[]>([
    { name: "screenshot-1.png", progress: 45 },
    { name: "button-icon.png", progress: 78 },
    { name: "background-image.jpg", progress: 12 },
  ])

  const handleCancel = (imageName: string) => {
    console.log("Cancelling upload:", imageName)
    // Remove from uploads or mark as cancelled
    setUploads(prev => prev.filter(upload => upload.name !== imageName))
  }

  // Simulate progress updates
  const simulateUpload = () => {
    const interval = setInterval(() => {
      setUploads(prev => {
        const updated = prev.map(upload => ({
          ...upload,
          progress: Math.min(upload.progress + 10, 100),
        }))

        // Remove completed uploads after a delay
        const filtered = updated.filter(upload => upload.progress < 100)

        if (filtered.length === 0) {
          clearInterval(interval)
        }

        return updated
      })
    }, 500)
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Upload Progress Demo</h2>
      <button
        onClick={simulateUpload}
        className="px-4 py-2 bg-[#00D9FF] text-black rounded"
      >
        Start Upload Simulation
      </button>

      <ImageUploadProgress
        uploads={uploads}
        onCancel={handleCancel}
      />
    </div>
  )
}

// Example 3: Real-world usage with file upload
function ExampleRealWorldUpload() {
  const [uploads, setUploads] = useState<UploadingImage[]>([])
  const projectId = 123 // Replace with actual project ID

  const handleFileUpload = async (files: FileList) => {
    const uploadPromises = Array.from(files).map(async (file) => {
      // Add to uploads state
      setUploads(prev => [...prev, { name: file.name, progress: 0 }])

      try {
        // Use apiClient.uploadProjectImage with progress callback
        const { apiClient } = await import("@/lib/api-client")

        const result = await apiClient.uploadProjectImage(
          projectId,
          file,
          (progress) => {
            // Update progress for this specific file
            setUploads(prev =>
              prev.map(upload =>
                upload.name === file.name
                  ? { ...upload, progress }
                  : upload
              )
            )
          }
        )

        // Upload complete - remove from list after delay
        setTimeout(() => {
          setUploads(prev => prev.filter(upload => upload.name !== file.name))
        }, 2000)

        return result
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error)
        // Remove failed upload
        setUploads(prev => prev.filter(upload => upload.name !== file.name))
        throw error
      }
    })

    await Promise.all(uploadPromises)
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Real Upload Example</h2>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => {
          if (e.target.files) {
            handleFileUpload(e.target.files)
          }
        }}
        className="mb-4"
      />

      <ImageUploadProgress uploads={uploads} />
    </div>
  )
}

// Example 4: Using ImageWithRefresh in a gallery
function ExampleImageGallery() {
  const projectId = 123
  const images: ImageAsset[] = [
    // ... your image assets
  ]

  return (
    <div className="grid grid-cols-3 gap-4">
      {images.map((image) => (
        <div key={image.id} className="aspect-square">
          <ImageWithRefresh
            imageAsset={image}
            projectId={projectId}
            alt={image.name}
            className="w-full h-full object-cover rounded"
            onRefresh={(newUrl) => {
              // Update image in your state/context
              console.log(`Image ${image.name} URL refreshed`)
            }}
          />
        </div>
      ))}
    </div>
  )
}

export {
  ExampleImageWithRefresh,
  ExampleImageUploadProgress,
  ExampleRealWorldUpload,
  ExampleImageGallery,
}
