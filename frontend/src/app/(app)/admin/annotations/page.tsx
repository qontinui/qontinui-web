'use client'

/**
 * GUI Element Annotation Tool - Web Version
 *
 * Admin-only page for creating ground truth annotations for GUI element detection research
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ImageCanvas, BoundingBox } from '@/components/common/ImageCanvas'
import {
  Upload,
  Save,
  Download,
  Trash2,
  FileImage,
  Plus,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

interface Annotation extends Omit<BoundingBox, 'id'> {
  id: string
  description?: string
  reason?: string
}

interface AnnotationSet {
  id?: string
  screenshot_name: string
  screenshot_url: string
  image_width: number
  image_height: number
  notes?: string
  annotations: Annotation[]
}

export default function AnnotationsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

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

  // State
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0)
  const [currentImageUrl, setCurrentImageUrl] = useState<string>('')
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null)

  const [boxes, setBoxes] = useState<BoundingBox[]>([])
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)

  // Form state for selected box
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [savedSets, setSavedSets] = useState<AnnotationSet[]>([])
  const [currentSetId, setCurrentSetId] = useState<string | undefined>()

  // Get selected box
  const selectedBox = boxes.find((b) => b.id === selectedBoxId)

  // Update form when selection changes
  useEffect(() => {
    if (selectedBox) {
      setLabel(selectedBox.label || '')
      const annotation = boxes.find((b) => b.id === selectedBoxId)
      if (annotation) {
        setDescription((annotation as any).description || '')
        setReason((annotation as any).reason || '')
      }
    } else {
      setLabel('')
      setDescription('')
      setReason('')
    }
  }, [selectedBoxId, boxes])

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setScreenshots(files)
    setCurrentScreenshotIndex(0)
    setBoxes([])
    setSelectedBoxId(null)

    // Load first image
    const file = files[0]
    const url = URL.createObjectURL(file)
    setCurrentImageUrl(url)

    // Get dimensions
    const img = new Image()
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height })
    }
    img.src = url

    toast.success(`Loaded ${files.length} screenshot(s)`)
  }

  // Handle screenshot navigation
  const handleScreenshotChange = (index: number) => {
    if (index < 0 || index >= screenshots.length) return

    setCurrentScreenshotIndex(index)
    const file = screenshots[index]
    const url = URL.createObjectURL(file)
    setCurrentImageUrl(url)

    // Get dimensions
    const img = new Image()
    img.onload = () => {
      setImageDimensions({ width: img.width, height: img.height })
    }
    img.src = url

    // Don't clear boxes - keep them when switching screenshots
  }

  // Handle box changes
  const handleBoxesChange = (newBoxes: BoundingBox[]) => {
    setBoxes(newBoxes)
  }

  // Handle box selection
  const handleBoxSelect = (boxId: string | null) => {
    setSelectedBoxId(boxId)
  }

  // Update selected box details
  const handleUpdateDetails = () => {
    if (!selectedBoxId) return

    const updatedBoxes = boxes.map((box) => {
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

    setBoxes(updatedBoxes)
    toast.success('Element details updated')
  }

  // Delete selected box
  const handleDeleteBox = () => {
    if (!selectedBoxId) return

    const updatedBoxes = boxes.filter((box) => box.id !== selectedBoxId)
    setBoxes(updatedBoxes)
    setSelectedBoxId(null)
    toast.success('Element deleted')
  }

  // Save annotations
  const handleSave = async () => {
    if (!currentImageUrl || !imageDimensions || boxes.length === 0) {
      toast.error('Please annotate at least one element before saving')
      return
    }

    setIsSaving(true)

    try {
      const annotationSet: AnnotationSet = {
        id: currentSetId,
        screenshot_name: screenshots[currentScreenshotIndex]?.name || 'screenshot.png',
        screenshot_url: currentImageUrl,
        image_width: imageDimensions.width,
        image_height: imageDimensions.height,
        notes,
        annotations: boxes.map((box) => ({
          id: box.id,
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          label: box.label,
          description: (box as any).description,
          reason: (box as any).reason,
        })),
      }

      const response = await fetch(
        currentSetId ? `/api/annotations/${currentSetId}` : '/api/annotations',
        {
          method: currentSetId ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(annotationSet),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to save annotations')
      }

      const saved = await response.json()
      setCurrentSetId(saved.id)

      toast.success('Annotations saved successfully')
    } catch (error) {
      console.error('Error saving annotations:', error)
      toast.error('Failed to save annotations')
    } finally {
      setIsSaving(false)
    }
  }

  // Export annotations as JSON
  const handleExport = () => {
    if (boxes.length === 0) {
      toast.error('No annotations to export')
      return
    }

    const annotationSet = {
      screenshot: screenshots[currentScreenshotIndex]?.name || 'screenshot.png',
      image_size: [imageDimensions?.width, imageDimensions?.height],
      num_elements: boxes.length,
      annotations: boxes.map((box) => ({
        bbox: [Math.round(box.x), Math.round(box.y), Math.round(box.x + box.width), Math.round(box.y + box.height)],
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
    a.download = `${screenshots[currentScreenshotIndex]?.name.replace(/\.[^/.]+$/, '')}_annotations.json`
    a.click()
    URL.revokeObjectURL(url)

    toast.success('Annotations exported')
  }

  // Load saved annotation sets
  const handleLoadDialog = async () => {
    try {
      const response = await fetch('/api/annotations')
      if (!response.ok) throw new Error('Failed to load annotation sets')

      const sets = await response.json()
      setSavedSets(sets)
      setShowLoadDialog(true)
    } catch (error) {
      console.error('Error loading annotation sets:', error)
      toast.error('Failed to load annotation sets')
    }
  }

  // Load a specific annotation set
  const handleLoadSet = (set: AnnotationSet) => {
    // TODO: Load screenshot from URL
    setBoxes(
      set.annotations.map((ann) => ({
        id: ann.id,
        x: ann.x,
        y: ann.y,
        width: ann.width,
        height: ann.height,
        label: ann.label,
        description: ann.description,
        reason: ann.reason,
      })) as BoundingBox[]
    )
    setNotes(set.notes || '')
    setCurrentSetId(set.id)
    setShowLoadDialog(false)
    toast.success('Annotation set loaded')
  }

  // Don't render until auth is confirmed
  if (!user?.is_superuser) {
    return null
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">GUI Element Annotation Tool</h1>
        <p className="text-muted-foreground">
          Create ground truth annotations for training GUI element detection models
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Screenshot Management */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Screenshots</CardTitle>
            <CardDescription>Upload and manage screenshots</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="screenshot-upload" className="cursor-pointer">
                <div className="flex items-center justify-center w-full h-32 border-2 border-dashed rounded-lg hover:bg-accent transition-colors">
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">Click to upload</p>
                  </div>
                </div>
              </Label>
              <Input
                id="screenshot-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            {screenshots.length > 0 && (
              <div className="space-y-2">
                <Label>Loaded Screenshots ({screenshots.length})</Label>
                <ScrollArea className="h-48">
                  <div className="space-y-1">
                    {screenshots.map((file, index) => (
                      <button
                        key={index}
                        onClick={() => handleScreenshotChange(index)}
                        className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                          index === currentScreenshotIndex
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent'
                        }`}
                      >
                        <FileImage className="inline h-4 w-4 mr-2" />
                        {file.name}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

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

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isSaving || boxes.length === 0} className="flex-1">
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              <Button onClick={handleExport} disabled={boxes.length === 0} variant="outline">
                <Download className="h-4 w-4" />
              </Button>
            </div>

            <Button onClick={handleLoadDialog} variant="outline" className="w-full">
              Load Saved
            </Button>
          </CardContent>
        </Card>

        {/* Middle Panel - Canvas */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Annotation Canvas</CardTitle>
            <CardDescription>
              {imageDimensions
                ? `${imageDimensions.width} × ${imageDimensions.height}px`
                : 'No image loaded'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentImageUrl ? (
              <ImageCanvas
                imageUrl={currentImageUrl}
                boxes={boxes}
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
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Element Details</CardTitle>
            <CardDescription>
              {boxes.length} element(s) annotated
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
                  {boxes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No elements annotated yet
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {boxes.map((box, index) => (
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
                      {new Date(set.created_at!).toLocaleString()}
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
