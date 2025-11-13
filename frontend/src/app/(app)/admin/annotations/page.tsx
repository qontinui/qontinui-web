'use client'

/**
 * GUI Element Annotation Tool - Web Version
 *
 * Admin-only page for creating ground truth annotations for GUI element detection research
 * Supports multiple screenshots with per-screenshot annotation management
 */

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { authService } from '@/services/service-factory'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { ImageCanvas, BoundingBox } from '@/components/common/ImageCanvas'
import { ScreenshotThumbnailStrip, ScreenshotData } from '@/components/annotations/ScreenshotThumbnailStrip'
import {
  Upload,
  Save,
  Download,
  Trash2,
  FileImage,
  Plus,
  Eye,
  EyeOff,
  LayoutDashboard,
  Shield,
  Sparkles,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Annotation extends Omit<BoundingBox, 'id'> {
  id: string
  description?: string
  reason?: string
  screenshot_index?: number
}

interface AnnotationSet {
  id?: string
  screenshot_name: string
  screenshot_url: string
  image_width: number
  image_height: number
  notes?: string
  boundary_width?: number
  annotations: Annotation[]
}

export default function AnnotationsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/')
      return
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error('Access denied - Admin privileges required')
      router.push('/dashboard')
      return
    }
  }, [user, authLoading, router])

  // Multi-screenshot state
  const [screenshots, setScreenshots] = useState<ScreenshotData[]>([])
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0)

  // Current screenshot data
  const currentScreenshot = screenshots[currentScreenshotIndex]
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)

  // Form state for selected box
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [boundaryWidth, setBoundaryWidth] = useState(5)

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [savedSets, setSavedSets] = useState<AnnotationSet[]>([])
  const [currentSetId, setCurrentSetId] = useState<string | undefined>()

  // Unsaved changes warning
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [pendingScreenshotIndex, setPendingScreenshotIndex] = useState<number | null>(null)

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false)

  // Get selected box
  const selectedBox = currentScreenshot?.annotations.find((b) => b.id === selectedBoxId)

  // Update form when selection changes
  useEffect(() => {
    if (selectedBox) {
      setLabel(selectedBox.label || '')
      setDescription((selectedBox as any).description || '')
      setReason((selectedBox as any).reason || '')
    } else {
      setLabel('')
      setDescription('')
      setReason('')
    }
  }, [selectedBoxId, selectedBox])

  // Load image dimensions
  const loadImageDimensions = async (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.width, height: img.height })
      }
      img.src = URL.createObjectURL(file)
    })
  }

  // Handle file upload
  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return

    const newScreenshots: ScreenshotData[] = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file)
        const dimensions = await loadImageDimensions(file)
        return {
          id: `screenshot-${Date.now()}-${Math.random()}`,
          file,
          url,
          dimensions,
          annotations: [],
          hasUnsavedChanges: false,
        }
      })
    )

    setScreenshots((prev) => [...prev, ...newScreenshots])

    // If this is the first upload, select the first screenshot
    if (screenshots.length === 0) {
      setCurrentScreenshotIndex(0)
    }

    setSelectedBoxId(null)
    toast.success(`Added ${files.length} screenshot(s)`)
  }

  // Handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    await handleFileUpload(files)

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/')
    )

    if (files.length > 0) {
      await handleFileUpload(files)
    }
  }

  // Handle screenshot navigation with unsaved changes check
  const handleScreenshotSelect = (index: number) => {
    if (index === currentScreenshotIndex) return

    // Check for unsaved changes
    if (currentScreenshot?.hasUnsavedChanges) {
      setPendingScreenshotIndex(index)
      setShowUnsavedWarning(true)
      return
    }

    switchToScreenshot(index)
  }

  // Switch to screenshot
  const switchToScreenshot = (index: number) => {
    setCurrentScreenshotIndex(index)
    setSelectedBoxId(null)
    setShowUnsavedWarning(false)
    setPendingScreenshotIndex(null)
  }

  // Confirm switch with unsaved changes
  const confirmSwitchScreenshot = () => {
    if (pendingScreenshotIndex !== null) {
      switchToScreenshot(pendingScreenshotIndex)
    }
  }

  // Handle screenshot removal
  const handleScreenshotRemove = (index: number) => {
    if (screenshots.length === 1) {
      toast.error('Cannot remove the last screenshot')
      return
    }

    const updatedScreenshots = screenshots.filter((_, i) => i !== index)
    setScreenshots(updatedScreenshots)

    // Adjust current index if needed
    if (currentScreenshotIndex >= updatedScreenshots.length) {
      setCurrentScreenshotIndex(updatedScreenshots.length - 1)
    }

    toast.success('Screenshot removed')
  }

  // Handle add screenshot button
  const handleAddScreenshot = () => {
    fileInputRef.current?.click()
  }

  // Handle box changes
  const handleBoxesChange = (newBoxes: BoundingBox[]) => {
    if (!currentScreenshot) return

    const updatedScreenshots = screenshots.map((screenshot, index) => {
      if (index === currentScreenshotIndex) {
        return {
          ...screenshot,
          annotations: newBoxes,
          hasUnsavedChanges: true,
        }
      }
      return screenshot
    })

    setScreenshots(updatedScreenshots)
  }

  // Handle box selection
  const handleBoxSelect = (boxId: string | null) => {
    setSelectedBoxId(boxId)
  }

  // Update selected box details
  const handleUpdateDetails = () => {
    if (!selectedBoxId || !currentScreenshot) return

    const updatedAnnotations = currentScreenshot.annotations.map((box) => {
      if (box.id === selectedBoxId) {
        return {
          ...box,
          label,
          description,
          reason,
        } as BoundingBox
      }
      return box
    })

    const updatedScreenshots = screenshots.map((screenshot, index) => {
      if (index === currentScreenshotIndex) {
        return {
          ...screenshot,
          annotations: updatedAnnotations,
          hasUnsavedChanges: true,
        }
      }
      return screenshot
    })

    setScreenshots(updatedScreenshots)
    toast.success('Element details updated')
  }

  // Delete selected box
  const handleDeleteBox = () => {
    if (!selectedBoxId || !currentScreenshot) return

    const updatedAnnotations = currentScreenshot.annotations.filter((box) => box.id !== selectedBoxId)

    const updatedScreenshots = screenshots.map((screenshot, index) => {
      if (index === currentScreenshotIndex) {
        return {
          ...screenshot,
          annotations: updatedAnnotations,
          hasUnsavedChanges: true,
        }
      }
      return screenshot
    })

    setScreenshots(updatedScreenshots)
    setSelectedBoxId(null)
    toast.success('Element deleted')
  }

  // Save current screenshot annotations
  // Updated: 2025-11-12 - Fixed API endpoint URL with trailing slash and proper auth headers
  const handleSave = async () => {
    if (!currentScreenshot || currentScreenshot.annotations.length === 0) {
      toast.error('Please annotate at least one element before saving')
      return
    }

    setIsSaving(true)

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      // Determine if we need to upload a new screenshot
      // If the URL is a blob URL, we need to upload; if it's already an S3 URL, we can reuse it
      let permanentUrl = currentScreenshot.url

      if (currentScreenshot.url.startsWith('blob:')) {
        // Step 1: Upload the screenshot file to get a permanent URL
        const formData = new FormData()
        formData.append('file', currentScreenshot.file)

        const uploadResponse = await fetch(`${apiUrl}/api/v1/annotations/upload-screenshot`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
          body: formData,
        })

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({ detail: 'Unknown error' }))
          throw new Error(errorData.detail || `Failed to upload screenshot (${uploadResponse.status})`)
        }

        const uploadResult = await uploadResponse.json()
        permanentUrl = uploadResult.url
      }

      // Step 2: Create or update the annotation set with the permanent URL
      const annotationSet: AnnotationSet = {
        screenshot_name: currentScreenshot.file.name,
        screenshot_url: permanentUrl,
        image_width: currentScreenshot.dimensions.width,
        image_height: currentScreenshot.dimensions.height,
        notes,
        boundary_width: boundaryWidth,
        annotations: currentScreenshot.annotations.map((box) => ({
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          label: box.label,
          description: (box as any).description,
          reason: (box as any).reason,
          screenshot_index: 0,
        })),
      }

      // Decide whether to create (POST) or update (PUT)
      const isUpdate = !!currentSetId
      const method = isUpdate ? 'PUT' : 'POST'
      const endpoint = isUpdate
        ? `${apiUrl}/api/v1/annotations/${currentSetId}`
        : `${apiUrl}/api/v1/annotations/`

      console.log('[Annotations] Attempting to save:', {
        hasToken: !!accessToken,
        tokenPreview: accessToken ? accessToken.substring(0, 20) + '...' : 'none',
        apiUrl,
        method,
        isUpdate,
        currentSetId,
        annotationCount: annotationSet.annotations.length,
        screenshotUrl: permanentUrl,
      })

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(annotationSet),
      })

      console.log('[Annotations] Response received:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
        console.error('[Annotations] Error response:', errorData)

        // Special handling for 401 Unauthorized
        if (response.status === 401) {
          throw new Error('Authentication failed. Please ensure you are logged in as an admin/superuser.')
        }

        throw new Error(errorData.detail || `Failed to save annotations (${response.status})`)
      }

      const saved = await response.json()

      // Set the current set ID if this was a new save
      if (!isUpdate && saved.id) {
        setCurrentSetId(saved.id)
      }

      // Mark as saved (no unsaved changes)
      const updatedScreenshots = screenshots.map((screenshot, index) => {
        if (index === currentScreenshotIndex) {
          return {
            ...screenshot,
            hasUnsavedChanges: false,
          }
        }
        return screenshot
      })

      setScreenshots(updatedScreenshots)

      const actionText = isUpdate ? 'updated' : 'saved'
      toast.success(`Annotations ${actionText} for ${currentScreenshot.file.name}`)
    } catch (error) {
      console.error('Error saving annotations:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to save annotations'
      toast.error(errorMessage)
    } finally {
      setIsSaving(false)
    }
  }

  // Save as new annotation set
  const handleSaveAs = async () => {
    // Clear the current set ID to force creating a new annotation set
    setCurrentSetId(undefined)
    // Then call the regular save function which will create a new set
    await handleSave()
  }

  // Save all screenshots
  const handleSaveAll = async () => {
    const screenshotsWithAnnotations = screenshots.filter(
      (screenshot) => screenshot.annotations.length > 0
    )

    if (screenshotsWithAnnotations.length === 0) {
      toast.error('No screenshots have annotations to save')
      return
    }

    setIsSaving(true)

    try {
      let successCount = 0
      let errorCount = 0

      for (const screenshot of screenshotsWithAnnotations) {
        const annotationSet: AnnotationSet = {
          screenshot_name: screenshot.file.name,
          screenshot_url: screenshot.url,
          image_width: screenshot.dimensions.width,
          image_height: screenshot.dimensions.height,
          notes,
          boundary_width: boundaryWidth,
          annotations: screenshot.annotations.map((box) => ({
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
            label: box.label,
            description: (box as any).description,
            reason: (box as any).reason,
            screenshot_index: 0,
          })),
        }

        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
          const accessToken = authService.tokenManager.getAccessToken()

          if (!accessToken) {
            throw new Error('Not authenticated')
          }

          const response = await fetch(`${apiUrl}/api/v1/annotations/`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(annotationSet),
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
            throw new Error(errorData.detail || `Failed to save (${response.status})`)
          }

          successCount++
        } catch (error) {
          console.error(`Error saving ${screenshot.file.name}:`, error)
          errorCount++
        }
      }

      // Mark all as saved
      const updatedScreenshots = screenshots.map((screenshot) => ({
        ...screenshot,
        hasUnsavedChanges: false,
      }))

      setScreenshots(updatedScreenshots)

      if (errorCount === 0) {
        toast.success(`Saved annotations for ${successCount} screenshot(s)`)
      } else {
        toast.warning(`Saved ${successCount} screenshot(s), ${errorCount} failed`)
      }
    } catch (error) {
      console.error('Error saving annotations:', error)
      toast.error('Failed to save annotations')
    } finally {
      setIsSaving(false)
    }
  }

  // Export current screenshot annotations as JSON
  const handleExport = () => {
    if (!currentScreenshot || currentScreenshot.annotations.length === 0) {
      toast.error('No annotations to export')
      return
    }

    const annotationSet = {
      screenshot: currentScreenshot.file.name,
      image_size: [currentScreenshot.dimensions.width, currentScreenshot.dimensions.height],
      num_elements: currentScreenshot.annotations.length,
      annotations: currentScreenshot.annotations.map((box) => ({
        bbox: [
          Math.round(box.x),
          Math.round(box.y),
          Math.round(box.x + box.width),
          Math.round(box.y + box.height),
        ],
        label: box.label || '',
        description: (box as any).description || '',
        reason: (box as any).reason || '',
        width: Math.round(box.width),
        height: Math.round(box.height),
        area: Math.round(box.width * box.height),
      })),
    }

    const blob = new Blob([JSON.stringify(annotationSet, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentScreenshot.file.name.replace(/\.[^/.]+$/, '')}_annotations.json`
    a.click()
    URL.revokeObjectURL(url)

    toast.success('Annotations exported')
  }

  // Export all screenshots
  const handleExportAll = () => {
    const screenshotsWithAnnotations = screenshots.filter(
      (screenshot) => screenshot.annotations.length > 0
    )

    if (screenshotsWithAnnotations.length === 0) {
      toast.error('No annotations to export')
      return
    }

    const allAnnotations = {
      export_date: new Date().toISOString(),
      total_screenshots: screenshotsWithAnnotations.length,
      screenshots: screenshotsWithAnnotations.map((screenshot) => ({
        screenshot: screenshot.file.name,
        image_size: [screenshot.dimensions.width, screenshot.dimensions.height],
        num_elements: screenshot.annotations.length,
        annotations: screenshot.annotations.map((box) => ({
          bbox: [
            Math.round(box.x),
            Math.round(box.y),
            Math.round(box.x + box.width),
            Math.round(box.y + box.height),
          ],
          label: box.label || '',
          description: (box as any).description || '',
          reason: (box as any).reason || '',
          width: Math.round(box.width),
          height: Math.round(box.height),
          area: Math.round(box.width * box.height),
        })),
      })),
    }

    const blob = new Blob([JSON.stringify(allAnnotations, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `all_annotations_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)

    toast.success(`Exported annotations for ${screenshotsWithAnnotations.length} screenshot(s)`)
  }

  // Load saved annotation sets
  const handleLoadDialog = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${apiUrl}/api/v1/annotations/`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(errorData.detail || `Failed to load annotation sets (${response.status})`)
      }

      const sets = await response.json()
      setSavedSets(sets)
      setShowLoadDialog(true)
    } catch (error) {
      console.error('Error loading annotation sets:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to load annotation sets'
      toast.error(errorMessage)
    }
  }

  // Load a specific annotation set
  const handleLoadSet = async (set: AnnotationSet) => {
    try {
      // Fetch the screenshot from the URL
      const response = await fetch(set.screenshot_url)
      if (!response.ok) {
        throw new Error('Failed to fetch screenshot')
      }

      // Convert to blob and then to File
      const blob = await response.blob()
      const file = new File([blob], set.screenshot_name, { type: blob.type })

      // Load image dimensions
      const url = URL.createObjectURL(file)
      const dimensions = await loadImageDimensions(file)

      // Create the screenshot data with saved annotations
      const newScreenshot: ScreenshotData = {
        id: `screenshot-${Date.now()}-${Math.random()}`,
        file,
        url,
        dimensions,
        annotations: set.annotations.map((ann) => ({
          id: ann.id,
          x: ann.x,
          y: ann.y,
          width: ann.width,
          height: ann.height,
          label: ann.label,
          color: '#3b82f6', // Default blue color
        })),
        hasUnsavedChanges: false,
      }

      // Replace current screenshots with the loaded one
      setScreenshots([newScreenshot])
      setCurrentScreenshotIndex(0)
      setNotes(set.notes || '')
      setBoundaryWidth(set.boundary_width || 5)
      setCurrentSetId(set.id)
      setShowLoadDialog(false)
      setSelectedBoxId(null)

      toast.success(`Loaded "${set.screenshot_name}" with ${set.annotations.length} annotation(s)`)
    } catch (error) {
      console.error('Error loading screenshot:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to load screenshot'
      toast.error(errorMessage)
    }
  }

  // Don't render until auth is confirmed
  if (authLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user?.is_superuser) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Admin Access Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This page is only accessible to administrators. You need superuser permissions to create and manage annotations.
            </p>
            <Button
              variant="outline"
              onClick={() => router.push('/dashboard')}
              className="mt-4"
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div
      className="container mx-auto py-8"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto h-16 w-16 text-primary mb-4" />
            <p className="text-xl font-semibold">Drop images here to upload</p>
          </div>
        </div>
      )}

      {/* Navigation Links */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/dashboard')}
          className="hover:bg-primary/10"
        >
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Dashboard
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push('/admin')}
          className="hover:bg-secondary/10"
        >
          <Shield className="mr-2 h-4 w-4" />
          Admin
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push('/admin/analysis')}
          className="hover:bg-accent/10"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Analysis
        </Button>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">GUI Element Annotation Tool</h1>
        <p className="text-muted-foreground">
          Create ground truth annotations for training GUI element detection models
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel - Screenshot Management */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Screenshots</CardTitle>
            <CardDescription>
              {screenshots.length > 0
                ? `${screenshots.length} screenshot(s) loaded`
                : 'Upload screenshots to begin'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="screenshot-upload" className="cursor-pointer">
                <div className="flex items-center justify-center w-full h-32 border-2 border-dashed rounded-lg hover:bg-accent transition-colors">
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Click to upload or drag & drop
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports multiple images
                    </p>
                  </div>
                </div>
              </Label>
              <Input
                ref={fileInputRef}
                id="screenshot-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            {currentScreenshot && (
              <>
                <div className="space-y-2">
                  <Label>Current Screenshot</Label>
                  <div className="text-sm space-y-1">
                    <div className="font-medium truncate" title={currentScreenshot.file.name}>
                      {currentScreenshot.file.name}
                    </div>
                    <div className="text-muted-foreground">
                      {currentScreenshot.dimensions.width} × {currentScreenshot.dimensions.height}px
                    </div>
                    <div className="text-muted-foreground">
                      {currentScreenshot.annotations.length} annotation(s)
                    </div>
                    {currentScreenshot.hasUnsavedChanges && (
                      <Badge variant="outline" className="text-orange-500 border-orange-500">
                        Unsaved changes
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Add notes about this annotation set..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="boundary-width">Boundary Width</Label>
                    <span className="text-sm text-muted-foreground">{boundaryWidth}px</span>
                  </div>
                  <Slider
                    id="boundary-width"
                    min={0}
                    max={50}
                    step={1}
                    value={[boundaryWidth]}
                    onValueChange={(value) => setBoundaryWidth(value[0])}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Tolerance for matching detected boxes to ground truth
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Actions</Label>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSave}
                      disabled={isSaving || currentScreenshot.annotations.length === 0}
                      className="flex-1"
                      size="sm"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {currentSetId ? 'Update' : 'Save'}
                    </Button>
                    {currentSetId && (
                      <Button
                        onClick={handleSaveAs}
                        disabled={isSaving || currentScreenshot.annotations.length === 0}
                        variant="outline"
                        size="sm"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Save As New
                      </Button>
                    )}
                    <Button
                      onClick={handleExport}
                      disabled={currentScreenshot.annotations.length === 0}
                      variant="outline"
                      size="sm"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                  {screenshots.length > 1 && (
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveAll}
                        disabled={isSaving}
                        variant="secondary"
                        className="flex-1"
                        size="sm"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        Save All
                      </Button>
                      <Button
                        onClick={handleExportAll}
                        variant="outline"
                        size="sm"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}

            <Button onClick={handleLoadDialog} variant="outline" className="w-full" size="sm">
              Load Saved
            </Button>
          </CardContent>
        </Card>

        {/* Middle Panel - Canvas */}
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle>Annotation Canvas</CardTitle>
            <CardDescription>
              {currentScreenshot
                ? `${currentScreenshot.dimensions.width} × ${currentScreenshot.dimensions.height}px`
                : 'No image loaded'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentScreenshot ? (
              <ImageCanvas
                imageUrl={currentScreenshot.url}
                boxes={currentScreenshot.annotations}
                selectedBoxId={selectedBoxId}
                onBoxesChange={handleBoxesChange}
                onBoxSelect={handleBoxSelect}
                className="h-[600px]"
              />
            ) : (
              <div className="flex items-center justify-center h-[600px] border-2 border-dashed rounded-lg">
                <div className="text-center text-muted-foreground">
                  <FileImage className="mx-auto h-12 w-12 mb-2" />
                  <p>Upload a screenshot to begin</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Panel - Element Details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Element Details</CardTitle>
            <CardDescription>
              {currentScreenshot?.annotations.length || 0} element(s) annotated
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="list" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="edit">Edit</TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-2">
                <ScrollArea className="h-[500px]">
                  {!currentScreenshot || currentScreenshot.annotations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No elements annotated yet
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {currentScreenshot.annotations.map((box, index) => (
                        <button
                          key={box.id}
                          onClick={() => setSelectedBoxId(box.id)}
                          className={`w-full text-left p-3 rounded border transition-colors ${
                            box.id === selectedBoxId
                              ? 'border-primary bg-accent'
                              : 'border-border hover:bg-accent'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="font-medium">
                                {box.label || `Element ${index + 1}`}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {Math.round(box.width)} × {Math.round(box.height)}px
                              </div>
                              {(box as any).description && (
                                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {(box as any).description}
                                </div>
                              )}
                            </div>
                            <Badge variant={box.id === selectedBoxId ? 'default' : 'secondary'}>
                              {index + 1}
                            </Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="edit" className="space-y-4">
                {selectedBox ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="label">Label *</Label>
                      <Input
                        id="label"
                        placeholder="e.g., Login Button"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        placeholder="Describe the element..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reason">Why is this useful?</Label>
                      <Textarea
                        id="reason"
                        placeholder="Explain why this element is important for detection..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Position: ({Math.round(selectedBox.x)}, {Math.round(selectedBox.y)})</div>
                      <div>Size: {Math.round(selectedBox.width)} × {Math.round(selectedBox.height)}px</div>
                      <div>Area: {Math.round(selectedBox.width * selectedBox.height)} px²</div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleUpdateDetails} className="flex-1">
                        Update
                      </Button>
                      <Button onClick={handleDeleteBox} variant="destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Select an element to edit its details
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Thumbnail Strip */}
      {screenshots.length > 0 && (
        <div className="mt-6">
          <ScreenshotThumbnailStrip
            screenshots={screenshots}
            currentIndex={currentScreenshotIndex}
            onScreenshotSelect={handleScreenshotSelect}
            onScreenshotRemove={handleScreenshotRemove}
            onAddScreenshot={handleAddScreenshot}
          />
        </div>
      )}

      {/* Unsaved Changes Warning Dialog */}
      <AlertDialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              The current screenshot has unsaved changes. If you switch to another screenshot, these
              changes will be lost. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitchScreenshot}>
              Switch Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Load Dialog */}
      <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load Annotation Set</DialogTitle>
            <DialogDescription>
              Select a previously saved annotation set to load
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-96">
            {savedSets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No saved annotation sets found
              </p>
            ) : (
              <div className="space-y-2">
                {savedSets.map((set) => (
                  <button
                    key={set.id}
                    onClick={() => handleLoadSet(set)}
                    className="w-full text-left p-4 rounded border hover:bg-accent transition-colors"
                  >
                    <div className="font-medium">{set.screenshot_name}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {set.annotations.length} elements • {set.image_width} × {set.image_height}px
                    </div>
                    {set.notes && (
                      <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {set.notes}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-2">
                      {new Date((set as any).created_at).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoadDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
