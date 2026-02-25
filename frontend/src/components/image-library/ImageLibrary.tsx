/**
 * Image Library Component
 *
 * Main orchestrator for the image management UI. Composes sub-components for
 * folder navigation, image grid/list display, filtering, bulk operations,
 * and image details.
 */

"use client";

import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  Upload,
  Search,
  Filter,
  Grid3x3,
  List,
  Play,
  X,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAutomation } from "@/contexts/automation-context";
import { toast } from "sonner";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { ImageViewMode, ImageGridSize, ImageWithMetadata } from "./types";
import { useImageOrganization } from "./useImageOrganization";
import {
  ImageUploadProgress,
  type UploadingImage,
} from "@/components/ImageUploadProgress";
import { uploadScreenshotOffline } from "@/lib/offline-screenshot-upload";
import { MaskEditor } from "@/components/mask-editor";
import {
  ImageDeletionDialog,
  type ImageUsageInfo,
} from "@/components/image-deletion-dialog";
import { MonitorSelector } from "@/components/monitor-selector";

// Sub-components
import { FilterBar } from "./FilterBar";
import { FolderTreeSidebar } from "./FolderTree";
import { ImageGrid, ImageList, ImageDetailsPanel } from "./ImageGrid";
import { BulkActions } from "./BulkActions";
import { CollectionsSidebar } from "./UploadDialog";
import { createLogger } from "@/lib/logger";
const logger = createLogger("ImageLibrary");

// ============================================================================
// Main Component
// ============================================================================

export function ImageLibrary() {
  const {
    images: contextImages,
    addImage,
    updateImage,
    deleteImage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
    projectId,
    projectName,
    workflows,
    states,
  } = useAutomation();

  // Convert to ImageWithMetadata
  const images = useMemo<ImageWithMetadata[]>(() => {
    return contextImages.map((img) => ({
      ...img,
      folderId: (img as ImageWithMetadata).folderId,
      tags: (img as ImageWithMetadata).tags || [],
      selected: false,
    }));
  }, [contextImages]);

  const {
    folders,
    folderTree,
    createFolder,
    updateFolder,
    deleteFolder,
    toggleFolderExpanded,
    collections,
    createCollection,
    updateCollection,
    deleteCollection,
    addImagesToCollection,
    currentFilter,
    setCurrentFilter,
    selectedImageIds,
    toggleImageSelection,
    clearSelection,
  } = useImageOrganization({
    images,
    onUpdateImage: updateImage as (image: ImageWithMetadata) => void,
  });

  // View state
  const [viewMode, setViewMode] = useState<ImageViewMode>("grid");
  const [gridSize, setGridSize] = useState<ImageGridSize>("medium");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"library" | "collections">(
    "library"
  );

  // Upload state
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [editingImage, setEditingImage] = useState<ImageAsset | null>(null);
  const [showDeletionDialog, setShowDeletionDialog] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<ImageAsset | null>(null);
  const [deletionUsageInfo, setDeletionUsageInfo] = useState<ImageUsageInfo>({
    states: [],
    processes: [],
  });

  // Monitor selection state
  const [uploadMonitors, setUploadMonitors] = useState<number[]>([0]);

  // ============================================================================
  // Filtering & Sorting
  // ============================================================================

  const filteredImages = useMemo(() => {
    let result = [...images];

    // Folder filter
    if (selectedFolderId) {
      result = result.filter((img) => img.folderId === selectedFolderId);
    }

    // Search query
    if (currentFilter.query) {
      const query = currentFilter.query.toLowerCase();
      result = result.filter((img) => img.name.toLowerCase().includes(query));
    }

    // Tags filter
    if (currentFilter.tags && currentFilter.tags.length > 0) {
      result = result.filter((img) => {
        const imgTags = img.tags || [];
        if (currentFilter.tagOperator === "AND") {
          return currentFilter.tags!.every((tag) => imgTags.includes(tag));
        } else {
          return currentFilter.tags!.some((tag) => imgTags.includes(tag));
        }
      });
    }

    // Source filter
    if (currentFilter.sources && currentFilter.sources.length > 0) {
      result = result.filter((img) =>
        currentFilter.sources!.includes(img.source)
      );
    }

    // Usage filter
    if (currentFilter.usageFilter) {
      if (currentFilter.usageFilter === "used") {
        result = result.filter((img) => img.usageCount > 0);
      } else if (currentFilter.usageFilter === "unused") {
        result = result.filter((img) => img.usageCount === 0);
      }
    }

    // Date range filter
    if (currentFilter.dateRange?.from) {
      result = result.filter(
        (img) => img.createdAt >= currentFilter.dateRange!.from!
      );
    }
    if (currentFilter.dateRange?.to) {
      result = result.filter(
        (img) => img.createdAt <= currentFilter.dateRange!.to!
      );
    }

    // Size filter
    if (currentFilter.minSize) {
      result = result.filter((img) => img.size >= currentFilter.minSize!);
    }
    if (currentFilter.maxSize) {
      result = result.filter((img) => img.size <= currentFilter.maxSize!);
    }

    return result;
  }, [images, selectedFolderId, currentFilter]);

  // ============================================================================
  // Upload Handlers
  // ============================================================================

  const handleFiles = useCallback(
    async (files: FileList) => {
      if (!projectId) {
        toast.error("No project selected", {
          description: "Please open a project before uploading images.",
        });
        return;
      }

      const fileArray = Array.from(files);

      // Validate file types
      const invalidFiles = fileArray.filter(
        (file) => !file.type.startsWith("image/")
      );
      if (invalidFiles.length > 0) {
        toast.error("Invalid file type", {
          description: `${invalidFiles[0]?.name ?? "Unknown file"} is not an image file.`,
        });
        return;
      }

      // Initialize upload progress
      const initialUploading: UploadingImage[] = fileArray.map((file) => ({
        name: file.name,
        progress: 0,
      }));
      setUploadingFiles(initialUploading);

      // Upload files with offline-first support
      const uploadPromises = fileArray.map(async (file) => {
        try {
          const result = await uploadScreenshotOffline(
            file,
            Number(projectId),
            {
              name: file.name,
              onProgress: (progress, _status) => {
                setUploadingFiles((prev) =>
                  prev.map((f) =>
                    f.name === file.name ? { ...f, progress } : f
                  )
                );
              },
            }
          );

          const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
          const imageAsset: ImageAsset = {
            id: result.screenshot.id,
            name: nameWithoutExtension,
            url: result.screenshot.url,
            size: file.size,
            createdAt: new Date(result.screenshot.uploadedAt),
            usageCount: 0,
            usage: [],
            source: "uploaded",
            projectName: projectName,
            s3_key: result.screenshot.s3Key,
            url_expires_at: result.screenshot.urlExpiresAt,
            monitors: uploadMonitors,
          };

          if (selectedFolderId) {
            (imageAsset as ImageWithMetadata).folderId = selectedFolderId;
          }

          addImage(imageAsset);
          toast.success(`${file.name} uploaded`);

          setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));

          result.whenSynced
            .then((serverData) => {
              const updatedAsset = {
                ...imageAsset,
                id: serverData.imageId,
                url: serverData.url,
                s3_key: serverData.s3Key,
              };
              addImage(updatedAsset);
            })
            .catch((error) => {
              logger.error("Sync failed for", file.name, error);
              toast.warning(
                `${file.name} saved locally, will sync when online`
              );
            });

          return { success: true, fileName: file.name };
        } catch (error: unknown) {
          logger.error(`Upload failed for ${file.name}:`, error);
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          toast.error(`Failed to save ${file.name}`, {
            description: errorMessage,
          });
          setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
          return { success: false, fileName: file.name };
        }
      });

      const results = await Promise.all(uploadPromises);
      const successCount = results.filter((r) => r.success).length;

      if (successCount > 0) {
        toast.success("Upload complete", {
          description: `${successCount} image(s) added to your library.`,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uploadMonitors is stable state that doesn't change frequently; including it would cause unnecessary callback recreation
    [projectId, projectName, selectedFolderId, addImage]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles]
  );

  // ============================================================================
  // Image Operations
  // ============================================================================

  const handleDeleteImage = useCallback(
    (imageId: string) => {
      const image = images.find((img) => img.id === imageId);
      if (!image) {
        toast.error("Image not found");
        return;
      }

      const usageInfo = getImageUsage(imageId);
      setImageToDelete(image);
      setDeletionUsageInfo(usageInfo);
      setShowDeletionDialog(true);
    },
    [images, getImageUsage]
  );

  const confirmDelete = useCallback(async () => {
    if (!imageToDelete) return;

    try {
      const statesAffected = await removeImageFromStates(imageToDelete.url);
      const processesAffected = await markImageAsRemovedInProcesses(
        imageToDelete.id,
        imageToDelete.name
      );

      deleteImage(imageToDelete.id);

      const details = [];
      if (statesAffected > 0) {
        details.push(
          `Removed from ${statesAffected} state${statesAffected > 1 ? "s" : ""}`
        );
      }
      if (processesAffected > 0) {
        details.push(
          `Marked as removed in ${processesAffected} workflow${processesAffected > 1 ? "s" : ""}`
        );
      }

      toast.success("Image deleted", {
        description:
          details.length > 0
            ? details.join(" and ")
            : "The image has been removed from your library.",
      });

      setImageToDelete(null);
      setDeletionUsageInfo({ states: [], processes: [] });
      setSelectedImageId(null);
    } catch (error) {
      toast.error("Failed to delete image", {
        description: "An error occurred while deleting the image.",
      });
      logger.error("Delete image error:", error);
    }
  }, [
    imageToDelete,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
    deleteImage,
  ]);

  const handleEditMask = useCallback((image: ImageAsset) => {
    setEditingImage(image);
    setShowMaskEditor(true);
  }, []);

  const handleSaveMask = useCallback(
    (maskedImage: string, mask: string) => {
      if (!editingImage) return;

      const updatedImage: ImageAsset = {
        ...editingImage,
        url: maskedImage,
        mask: mask,
      };

      updateImage(updatedImage);
      setShowMaskEditor(false);
      setEditingImage(null);
      toast.success("Mask applied to image", {
        description: "The image has been updated with the new mask.",
      });
    },
    [editingImage, updateImage]
  );

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  const handleBulkMove = useCallback(
    (targetFolderId: string | null) => {
      selectedImageIds.forEach((imageId) => {
        const image = images.find((img) => img.id === imageId);
        if (image) {
          const updatedImage: ImageWithMetadata = {
            ...image,
            folderId: targetFolderId,
          };
          updateImage(updatedImage as ImageAsset);
        }
      });
      toast.success(`Moved ${selectedImageIds.size} image(s)`);
      clearSelection();
    },
    [selectedImageIds, images, updateImage, clearSelection]
  );

  const handleBulkAddToCollection = useCallback(
    (collectionId: string) => {
      addImagesToCollection(collectionId, Array.from(selectedImageIds));
      toast.success(`Added ${selectedImageIds.size} image(s) to collection`);
      clearSelection();
    },
    [selectedImageIds, addImagesToCollection, clearSelection]
  );

  const handleBulkDelete = useCallback(() => {
    const count = selectedImageIds.size;
    selectedImageIds.forEach((imageId) => {
      deleteImage(imageId);
    });
    toast.success(`Deleted ${count} image(s)`);
    clearSelection();
  }, [selectedImageIds, deleteImage, clearSelection]);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const selectedImage = useMemo(() => {
    return selectedImageId
      ? images.find((img) => img.id === selectedImageId)
      : null;
  }, [selectedImageId, images]);

  const imageUsageDetails = useMemo(() => {
    if (!selectedImage) return [];

    const details: Array<{
      workflowId: string;
      workflowName: string;
      stateId?: string;
      stateName?: string;
    }> = [];

    workflows.forEach((workflow) => {
      const usesImage = workflow.actions.some((action) => {
        const config = action.config as { imageId?: string };
        return config.imageId === selectedImage.id;
      });
      if (usesImage) {
        details.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
        });
      }
    });

    states.forEach((state) => {
      const usesImage = state.stateImages.some((stateImage) =>
        stateImage.patterns.some(
          (pattern) => pattern.imageId === selectedImage.id
        )
      );
      if (usesImage) {
        details.push({
          workflowId: "",
          workflowName: "",
          stateId: state.id,
          stateName: state.name,
        });
      }
    });

    return details;
  }, [selectedImage, workflows, states]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      {/* Upload Progress */}
      <ImageUploadProgress uploads={uploadingFiles} />

      {/* Top Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Image Library</h2>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-surface-raised/50 border-border-default"
            >
              {filteredImages.length} images
            </Badge>
            {selectedImageIds.size > 0 && (
              <Badge className="bg-brand-success text-black">
                {selectedImageIds.size} selected
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              placeholder="Search images..."
              value={currentFilter.query || ""}
              onChange={(e) =>
                setCurrentFilter({ ...currentFilter, query: e.target.value })
              }
              className="pl-10 w-64 bg-transparent border-border-default focus:border-brand-success"
            />
            {currentFilter.query && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={() =>
                  setCurrentFilter({ ...currentFilter, query: "" })
                }
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* View Controls */}
          <div className="flex items-center gap-1 bg-surface-raised rounded-lg p-1">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className={cn(
                viewMode === "grid" && "bg-brand-success text-black"
              )}
            >
              <Grid3x3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className={cn(
                viewMode === "list" && "bg-brand-success text-black"
              )}
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "slideshow" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("slideshow")}
              className={cn(
                viewMode === "slideshow" && "bg-brand-success text-black"
              )}
            >
              <Play className="w-4 h-4" />
            </Button>
          </div>

          {/* Grid Size Slider */}
          {viewMode === "grid" && (
            <div className="flex items-center gap-2 bg-surface-raised rounded-lg px-3 py-2">
              <Minus className="w-3 h-3 text-text-muted" />
              <Slider
                value={[
                  gridSize === "small" ? 0 : gridSize === "medium" ? 50 : 100,
                ]}
                onValueChange={(values) => {
                  const value = values[0];
                  if (value === undefined) return;
                  if (value < 33) setGridSize("small");
                  else if (value < 67) setGridSize("medium");
                  else setGridSize("large");
                }}
                max={100}
                step={1}
                className="w-24"
              />
              <Plus className="w-3 h-3 text-text-muted" />
            </div>
          )}

          {/* Filters */}
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              showFilters && "bg-brand-success text-black",
              "border-border-default"
            )}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>

          {/* Upload */}
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="bg-brand-success hover:bg-brand-success/80 text-black"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Monitor Selection Panel */}
      <div className="p-4 bg-surface-raised/50 border-b border-border-default">
        <MonitorSelector
          monitors={uploadMonitors}
          onChange={setUploadMonitors}
          label="Default Monitors for New Uploads"
          showLabel={true}
        />
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <FilterBar filter={currentFilter} onFilterChange={setCurrentFilter} />
      )}

      {/* Bulk Operations Toolbar */}
      <BulkActions
        selectedCount={selectedImageIds.size}
        folders={folders}
        collections={collections}
        onBulkMove={handleBulkMove}
        onBulkAddToCollection={handleBulkAddToCollection}
        onBulkDelete={handleBulkDelete}
        onClearSelection={clearSelection}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Folders & Collections */}
        <div className="w-64 border-r border-border-subtle flex flex-col">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "library" | "collections")}
            className="flex-1 flex flex-col"
          >
            <TabsList className="grid w-full grid-cols-2 bg-surface-raised m-2">
              <TabsTrigger value="library">Library</TabsTrigger>
              <TabsTrigger value="collections">Collections</TabsTrigger>
            </TabsList>

            <TabsContent
              value="library"
              className="flex-1 overflow-hidden mt-0"
            >
              <FolderTreeSidebar
                folders={folderTree}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                onCreateFolder={(name, parentId) =>
                  createFolder(name, parentId)
                }
                onUpdateFolder={updateFolder}
                onDeleteFolder={deleteFolder}
                onToggleExpanded={toggleFolderExpanded}
              />
            </TabsContent>

            <TabsContent
              value="collections"
              className="flex-1 overflow-hidden mt-0"
            >
              <CollectionsSidebar
                collections={collections}
                onCreateCollection={createCollection}
                onUpdateCollection={updateCollection}
                onDeleteCollection={deleteCollection}
                images={images}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Center - Image Grid */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewMode === "grid" && (
            <ImageGrid
              images={filteredImages}
              gridSize={gridSize}
              selectedImageIds={selectedImageIds}
              selectedImageId={selectedImageId}
              onSelectImage={setSelectedImageId}
              onToggleSelection={toggleImageSelection}
              onDeleteImage={handleDeleteImage}
              onEditMask={handleEditMask}
              dragActive={dragActive}
              onDrag={handleDrag}
              onDrop={handleDrop}
            />
          )}

          {viewMode === "list" && (
            <ImageList
              images={filteredImages}
              selectedImageIds={selectedImageIds}
              selectedImageId={selectedImageId}
              onSelectImage={setSelectedImageId}
              onToggleSelection={toggleImageSelection}
              onDeleteImage={handleDeleteImage}
            />
          )}
        </div>

        {/* Right Sidebar - Image Details */}
        {selectedImage && (
          <div className="w-80 border-l border-border-subtle flex flex-col">
            <ImageDetailsPanel
              image={selectedImage}
              usageDetails={imageUsageDetails}
              onClose={() => setSelectedImageId(null)}
              onDelete={() => handleDeleteImage(selectedImage.id)}
              onEditMask={() => handleEditMask(selectedImage)}
            />
          </div>
        )}
      </div>

      {/* Mask Editor */}
      {showMaskEditor && editingImage && (
        <MaskEditor
          imageUrl={editingImage.url}
          imageName={editingImage.name}
          initialMask={editingImage.mask}
          onSave={handleSaveMask}
          onCancel={() => {
            setShowMaskEditor(false);
            setEditingImage(null);
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
  );
}

/**
 * @deprecated Use `ImageLibrary` instead. This alias exists for backward compatibility.
 */
export const EnhancedImageLibrary = ImageLibrary;
