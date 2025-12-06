/**
 * Enhanced Image Library Component
 *
 * Comprehensive image management UI with folders, collections, advanced filtering,
 * and bulk operations for large projects.
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
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Trash2,
  Download,
  Tag,
  Move,
  Plus,
  Minus,
  Check,
  MoreVertical,
  Edit,
  Package,
  Eye,
  Calendar,
  HardDrive,
  Link2,
  Layers,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAutomation } from "@/contexts/automation-context";
import { toast } from "sonner";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type {
  ImageFolder,
  ImageFolderTreeNode,
  ImageCollection,
  ImageFilter,
  ImageViewMode,
  ImageGridSize,
  ImageWithMetadata,
} from "./types";
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
import { LazyImage } from "./LazyImage";

// ============================================================================
// Main Component
// ============================================================================

export function EnhancedImageLibrary() {
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
      folderId: (img as any).folderId,
      tags: (img as any).tags || [],
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
  } = useImageOrganization({ images, onUpdateImage: updateImage as any });

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

  // Bulk operations state
  // const [showBulkToolbar, setShowBulkToolbar] = useState(false);

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
          // Upload immediately (works offline)
          const result = await uploadScreenshotOffline(file, Number(projectId), {
            name: file.name,
            onProgress: (progress, _status) => {
              setUploadingFiles((prev) =>
                prev.map((f) => (f.name === file.name ? { ...f, progress } : f))
              );
            },
          });

          // Screenshot available immediately in UI
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
          };

          // Add folder assignment if a folder is selected
          if (selectedFolderId) {
            (imageAsset as any).folderId = selectedFolderId;
          }

          addImage(imageAsset);
          toast.success(`${file.name} uploaded`);

          setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));

          // Wait for server sync in background
          result.whenSynced
            .then((serverData) => {
              // Update with server data when synced
              const updatedAsset = {
                ...imageAsset,
                id: serverData.imageId,
                url: serverData.url,
                s3_key: serverData.s3Key,
              };
              addImage(updatedAsset);
            })
            .catch((error) => {
              console.error("Sync failed for", file.name, error);
              toast.warning(
                `${file.name} saved locally, will sync when online`
              );
            });

          return { success: true, fileName: file.name };
        } catch (error: any) {
          console.error(`Upload failed for ${file.name}:`, error);
          toast.error(`Failed to save ${file.name}`, {
            description: error.message || "Unknown error occurred",
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
      console.error("Delete image error:", error);
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
          updateImage({ ...image, folderId: targetFolderId } as any);
        }
      });
      toast.success(`Moved ${selectedImageIds.size} image(s)`);
      clearSelection();
    },
    [selectedImageIds, images, updateImage, clearSelection]
  );

  // const handleBulkTag = useCallback(
  //   (tagName: string) => {
  //     addTagToImages(Array.from(selectedImageIds), tagName);
  //     toast.success(`Tagged ${selectedImageIds.size} image(s)`);
  //   },
  //   [selectedImageIds, addTagToImages]
  // );

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
  // Helper Functions
  // ============================================================================

  /**
   * Get the appropriate image URL based on context
   * For grid/list view: use thumb for performance
   * For detail view: use original
   */
  const getImageUrl = (
    image: ImageAsset,
    size: "thumb" | "medium" | "original" = "thumb"
  ): string => {
    // If the image has variants (new format), use them
    if ((image as any).variants) {
      const variants = (image as any).variants as Record<string, string>;
      return variants[size] || variants.thumb || image.url;
    }

    // Fallback to legacy URL
    return image.url;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (
      Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    );
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "uploaded":
        return "Uploaded";
      case "pattern_optimization":
        return "Pattern Opt";
      case "image_extraction":
        return "Extraction";
      case "state_discovery":
        return "Discovery";
      default:
        return "Unknown";
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case "uploaded":
        return "#00FF88";
      case "pattern_optimization":
        return "#00D9FF";
      case "image_extraction":
        return "#BD00FF";
      case "state_discovery":
        return "#FFB800";
      default:
        return "#6B7280";
    }
  };

  // const getGridSizeClass = () => {
  //   switch (gridSize) {
  //     case "small":
  //       return "grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20";
  //     case "medium":
  //       return "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
  //     case "large":
  //       return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  //     default:
  //       return "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
  //   }
  // };

  // const getImageCardSize = () => {
  //   switch (gridSize) {
  //     case "small":
  //       return "w-16 h-16";
  //     case "medium":
  //       return "w-32 h-32";
  //     case "large":
  //       return "w-48 h-48";
  //     default:
  //       return "w-32 h-32";
  //   }
  // };

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

    // Check workflows
    workflows.forEach((workflow) => {
      // Check if image is used in any action in the workflow
      const usesImage = workflow.actions.some((action) => {
        const config = action.config as any;
        return config.imageId === selectedImage.id;
      });
      if (usesImage) {
        details.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
        });
      }
    });

    // Check states
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
    <div className="h-full flex flex-col bg-[#18181B]">
      {/* Upload Progress */}
      <ImageUploadProgress uploads={uploadingFiles} />

      {/* Top Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Image Library</h2>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-[#27272A]/50 border-gray-700"
            >
              {filteredImages.length} images
            </Badge>
            {selectedImageIds.size > 0 && (
              <Badge className="bg-[#00FF88] text-black">
                {selectedImageIds.size} selected
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search images..."
              value={currentFilter.query || ""}
              onChange={(e) =>
                setCurrentFilter({ ...currentFilter, query: e.target.value })
              }
              className="pl-10 w-64 bg-transparent border-gray-700 focus:border-[#00FF88]"
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
          <div className="flex items-center gap-1 bg-[#27272A] rounded-lg p-1">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className={cn(viewMode === "grid" && "bg-[#00FF88] text-black")}
            >
              <Grid3x3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className={cn(viewMode === "list" && "bg-[#00FF88] text-black")}
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "slideshow" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("slideshow")}
              className={cn(
                viewMode === "slideshow" && "bg-[#00FF88] text-black"
              )}
            >
              <Play className="w-4 h-4" />
            </Button>
          </div>

          {/* Grid Size Slider */}
          {viewMode === "grid" && (
            <div className="flex items-center gap-2 bg-[#27272A] rounded-lg px-3 py-2">
              <Minus className="w-3 h-3 text-gray-400" />
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
              <Plus className="w-3 h-3 text-gray-400" />
            </div>
          )}

          {/* Filters */}
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              showFilters && "bg-[#00FF88] text-black",
              "border-gray-700"
            )}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>

          {/* Upload */}
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#00FF88] hover:bg-[#00FF88]/80 text-black"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <FilterPanel filter={currentFilter} onFilterChange={setCurrentFilter} />
      )}

      {/* Bulk Operations Toolbar */}
      {selectedImageIds.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-[#00FF88]/10 border-b border-[#00FF88]/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {selectedImageIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-gray-700">
                  <Move className="w-4 h-4 mr-2" />
                  Move to Folder
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleBulkMove(null)}>
                  Root (No Folder)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {folders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => handleBulkMove(folder.id)}
                  >
                    <Folder
                      className="w-4 h-4 mr-2"
                      style={{ color: folder.color }}
                    />
                    {folder.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" className="border-gray-700">
              <Tag className="w-4 h-4 mr-2" />
              Add Tags
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-gray-700">
                  <Package className="w-4 h-4 mr-2" />
                  Add to Collection
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {collections.map((collection) => (
                  <DropdownMenuItem
                    key={collection.id}
                    onClick={() => handleBulkAddToCollection(collection.id)}
                  >
                    {collection.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" className="border-gray-700">
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="border-red-700 text-red-400 hover:bg-red-900/20"
              onClick={handleBulkDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>

            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

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
        <div className="w-64 border-r border-gray-800 flex flex-col">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as any)}
            className="flex-1 flex flex-col"
          >
            <TabsList className="grid w-full grid-cols-2 bg-[#27272A] m-2">
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
                getImageUrl={getImageUrl}
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
              formatFileSize={formatFileSize}
              getSourceLabel={getSourceLabel}
              getSourceColor={getSourceColor}
              getImageUrl={getImageUrl}
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
              formatFileSize={formatFileSize}
              getSourceLabel={getSourceLabel}
              getSourceColor={getSourceColor}
              getImageUrl={getImageUrl}
            />
          )}
        </div>

        {/* Right Sidebar - Image Details */}
        {selectedImage && (
          <div className="w-80 border-l border-gray-800 flex flex-col">
            <ImageDetailsPanel
              image={selectedImage}
              usageDetails={imageUsageDetails}
              onClose={() => setSelectedImageId(null)}
              onDelete={() => handleDeleteImage(selectedImage.id)}
              onEditMask={() => handleEditMask(selectedImage)}
              formatFileSize={formatFileSize}
              getSourceLabel={getSourceLabel}
              getSourceColor={getSourceColor}
              getImageUrl={getImageUrl}
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

// ============================================================================
// Sub-Components
// ============================================================================

interface FilterPanelProps {
  filter: ImageFilter;
  onFilterChange: (filter: ImageFilter) => void;
}

function FilterPanel({ filter, onFilterChange }: FilterPanelProps) {
  return (
    <div className="p-4 bg-[#27272A]/50 border-b border-gray-800">
      <div className="grid grid-cols-4 gap-4">
        {/* Source Filter */}
        <div>
          <label className="text-xs text-gray-400 mb-2 block">Source</label>
          <div className="flex flex-wrap gap-1">
            {[
              "uploaded",
              "pattern_optimization",
              "image_extraction",
              "state_discovery",
            ].map((source) => (
              <Badge
                key={source}
                variant="outline"
                className={cn(
                  "cursor-pointer transition-all",
                  filter.sources?.includes(source as any)
                    ? "bg-[#00FF88] text-black border-[#00FF88]"
                    : "border-gray-700 hover:border-gray-600"
                )}
                onClick={() => {
                  const sources = filter.sources || [];
                  const newSources = sources.includes(source as any)
                    ? sources.filter((s) => s !== source)
                    : [...sources, source as any];
                  onFilterChange({ ...filter, sources: newSources });
                }}
              >
                {source === "uploaded" && "Uploaded"}
                {source === "pattern_optimization" && "Pattern Opt"}
                {source === "image_extraction" && "Extraction"}
                {source === "state_discovery" && "Discovery"}
              </Badge>
            ))}
          </div>
        </div>

        {/* Usage Filter */}
        <div>
          <label className="text-xs text-gray-400 mb-2 block">Usage</label>
          <div className="flex gap-1">
            {["all", "used", "unused"].map((usage) => (
              <Badge
                key={usage}
                variant="outline"
                className={cn(
                  "cursor-pointer transition-all",
                  filter.usageFilter === usage
                    ? "bg-[#00FF88] text-black border-[#00FF88]"
                    : "border-gray-700 hover:border-gray-600"
                )}
                onClick={() =>
                  onFilterChange({ ...filter, usageFilter: usage as any })
                }
              >
                {usage.charAt(0).toUpperCase() + usage.slice(1)}
              </Badge>
            ))}
          </div>
        </div>

        {/* Clear Filters */}
        <div className="flex items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onFilterChange({})}
            className="border-gray-700"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        </div>
      </div>
    </div>
  );
}

// Folder Tree Sidebar
interface FolderTreeSidebarProps {
  folders: ImageFolderTreeNode[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<ImageFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onToggleExpanded: (folderId: string) => void;
}

function FolderTreeSidebar({
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleExpanded,
}: FolderTreeSidebarProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName, null);
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-800">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewFolder(!showNewFolder)}
          className="w-full border-gray-700"
        >
          <FolderPlus className="w-4 h-4 mr-2" />
          New Folder
        </Button>

        {showNewFolder && (
          <div className="mt-2 flex gap-1">
            <Input
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              className="text-sm bg-transparent border-gray-700"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleCreateFolder}
              className="bg-[#00FF88] text-black"
            >
              <Check className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* All Images */}
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-1",
              selectedFolderId === null
                ? "bg-[#00FF88]/20 text-[#00FF88]"
                : "hover:bg-[#27272A]"
            )}
            onClick={() => onSelectFolder(null)}
          >
            <ImageIcon className="w-4 h-4" />
            <span className="text-sm font-medium flex-1">All Images</span>
          </div>

          {/* Folder Tree */}
          {folders.map((folder) => (
            <FolderTreeNode
              key={folder.id}
              folder={folder}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onUpdateFolder={onUpdateFolder}
              onDeleteFolder={onDeleteFolder}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// Folder Tree Node
interface FolderTreeNodeProps {
  folder: ImageFolderTreeNode;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onUpdateFolder: (id: string, updates: Partial<ImageFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onToggleExpanded: (folderId: string) => void;
}

function FolderTreeNode({
  folder,
  selectedFolderId,
  onSelectFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleExpanded,
}: FolderTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);

  const handleSaveEdit = () => {
    if (editName.trim() && editName !== folder.name) {
      onUpdateFolder(folder.id, { name: editName });
    }
    setIsEditing(false);
  };

  return (
    <div style={{ marginLeft: `${folder.depth * 12}px` }}>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors group",
          selectedFolderId === folder.id
            ? "bg-[#00FF88]/20 text-[#00FF88]"
            : "hover:bg-[#27272A]"
        )}
      >
        {folder.children.length > 0 && (
          <button onClick={() => onToggleExpanded(folder.id)} className="p-0">
            {folder.expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        )}

        <div
          className="flex items-center gap-2 flex-1 cursor-pointer"
          onClick={() => !isEditing && onSelectFolder(folder.id)}
        >
          {folder.expanded ? (
            <FolderOpen className="w-4 h-4" style={{ color: folder.color }} />
          ) : (
            <Folder className="w-4 h-4" style={{ color: folder.color }} />
          )}

          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit();
                if (e.key === "Escape") {
                  setIsEditing(false);
                  setEditName(folder.name);
                }
              }}
              onBlur={handleSaveEdit}
              className="text-sm h-6 bg-transparent border-gray-700"
              autoFocus
            />
          ) : (
            <>
              <span className="text-sm font-medium flex-1">{folder.name}</span>
              <Badge variant="outline" className="text-xs border-gray-700">
                {folder.totalImageCount}
              </Badge>
            </>
          )}
        </div>

        {!isEditing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
              >
                <MoreVertical className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDeleteFolder(folder.id)}
                className="text-red-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {folder.expanded &&
        folder.children.map((child) => (
          <FolderTreeNode
            key={child.id}
            folder={child}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onUpdateFolder={onUpdateFolder}
            onDeleteFolder={onDeleteFolder}
            onToggleExpanded={onToggleExpanded}
          />
        ))}
    </div>
  );
}

// Collections Sidebar
interface CollectionsSidebarProps {
  collections: ImageCollection[];
  onCreateCollection: (name: string, description?: string) => void;
  onUpdateCollection: (id: string, updates: Partial<ImageCollection>) => void;
  onDeleteCollection: (id: string) => void;
  images: ImageWithMetadata[];
  getImageUrl: (image: ImageAsset, size?: "thumb" | "medium" | "original") => string;
}

function CollectionsSidebar({
  collections,
  onCreateCollection,
  onUpdateCollection: _onUpdateCollection,
  onDeleteCollection,
  images,
  getImageUrl,
}: CollectionsSidebarProps) {
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");

  const handleCreate = () => {
    if (newCollectionName.trim()) {
      onCreateCollection(newCollectionName);
      setNewCollectionName("");
      setShowNewCollection(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-800">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewCollection(!showNewCollection)}
          className="w-full border-gray-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Collection
        </Button>

        {showNewCollection && (
          <div className="mt-2 flex gap-1">
            <Input
              placeholder="Collection name..."
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="text-sm bg-transparent border-gray-700"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleCreate}
              className="bg-[#00FF88] text-black"
            >
              <Check className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {collections.map((collection) => (
            <Card
              key={collection.id}
              className="border-gray-700 bg-[#27272A] hover:border-gray-600 transition-colors cursor-pointer"
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-sm">{collection.name}</h4>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => onDeleteCollection(collection.id)}
                        className="text-red-400"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Thumbnail Grid */}
                <div className="grid grid-cols-2 gap-1 mb-2">
                  {collection.thumbnailIds.slice(0, 4).map((imageId) => {
                    const image = images.find((img) => img.id === imageId);
                    return (
                      <div
                        key={imageId}
                        className="aspect-square bg-gray-800 rounded overflow-hidden"
                      >
                        {image && (
                          <LazyImage
                            src={getImageUrl(image, "thumb")}
                            alt={image.name}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="text-xs text-gray-400">
                  {collection.imageIds.length} image
                  {collection.imageIds.length !== 1 && "s"}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// Image Grid
interface ImageGridProps {
  images: ImageWithMetadata[];
  gridSize: ImageGridSize;
  selectedImageIds: Set<string>;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onDeleteImage: (id: string) => void;
  onEditMask: (image: ImageAsset) => void;
  formatFileSize: (bytes: number) => string;
  getSourceLabel: (source: string) => string;
  getSourceColor: (source: string) => string;
  getImageUrl: (
    image: ImageAsset,
    size?: "thumb" | "medium" | "original"
  ) => string;
  dragActive: boolean;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ImageGrid({
  images,
  gridSize,
  selectedImageIds,
  selectedImageId,
  onSelectImage,
  onToggleSelection,
  onDeleteImage,
  onEditMask,
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
  dragActive,
  onDrag,
  onDrop,
}: ImageGridProps) {
  const getGridSizeClass = () => {
    switch (gridSize) {
      case "small":
        return "grid-cols-8 md:grid-cols-12 lg:grid-cols-16 xl:grid-cols-20";
      case "medium":
        return "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
      case "large":
        return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
      default:
        return "grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10";
    }
  };

  if (images.length === 0) {
    return (
      <div
        className={cn(
          "flex-1 flex items-center justify-center border-2 border-dashed m-4 rounded-lg transition-colors",
          dragActive ? "border-[#00FF88] bg-[#00FF88]/10" : "border-gray-700"
        )}
        onDragEnter={onDrag}
        onDragLeave={onDrag}
        onDragOver={onDrag}
        onDrop={onDrop}
      >
        <div className="text-center">
          <Upload
            className={cn(
              "w-16 h-16 mx-auto mb-4",
              dragActive ? "text-[#00FF88]" : "text-gray-500"
            )}
          />
          <p className="text-lg mb-2">No images found</p>
          <p className="text-sm text-gray-400">
            Drag & drop images here or click Upload to add images
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className={cn("grid gap-2 p-4", getGridSizeClass())}>
        {images.map((image) => (
          <Card
            key={image.id}
            className={cn(
              "border-gray-700 bg-[#27272A] transition-all group cursor-pointer relative",
              selectedImageId === image.id && "ring-2 ring-[#00FF88]",
              selectedImageIds.has(image.id) && "ring-2 ring-blue-500"
            )}
            onClick={() => onSelectImage(image.id)}
          >
            <CardContent className="p-2">
              {/* Selection Checkbox */}
              <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Checkbox
                  checked={selectedImageIds.has(image.id)}
                  onCheckedChange={() => onToggleSelection(image.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-black/50 border-gray-500"
                />
              </div>

              {/* Image Preview */}
              <div className="aspect-square bg-gray-800 rounded overflow-hidden relative mb-2">
                <LazyImage
                  src={getImageUrl(image, "thumb")}
                  alt={image.name}
                  className="w-full h-full object-contain"
                />

                {/* Hover Actions */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-purple-400 hover:text-purple-300 hover:bg-purple-400/20 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditMask(image);
                    }}
                    title="Edit Mask"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/20 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(image.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Image Info */}
              {gridSize !== "small" && (
                <div className="space-y-1">
                  <h4
                    className="font-medium text-xs truncate"
                    title={image.name}
                  >
                    {image.name}
                  </h4>

                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{formatFileSize(image.size)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <Badge
                      variant={image.usageCount > 0 ? "default" : "secondary"}
                      className={cn(
                        "text-xs px-1 py-0 h-4",
                        image.usageCount > 0
                          ? "bg-[#00FF88] text-black"
                          : "bg-gray-700 text-gray-300"
                      )}
                    >
                      {image.usageCount}x
                    </Badge>
                    <Badge
                      className="text-xs px-1 py-0 h-4"
                      style={{
                        backgroundColor: getSourceColor(image.source),
                        color: "black",
                      }}
                    >
                      {getSourceLabel(image.source)}
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

// Image List View
interface ImageListProps {
  images: ImageWithMetadata[];
  selectedImageIds: Set<string>;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onDeleteImage: (id: string) => void;
  formatFileSize: (bytes: number) => string;
  getSourceLabel: (source: string) => string;
  getSourceColor: (source: string) => string;
  getImageUrl: (
    image: ImageAsset,
    size?: "thumb" | "medium" | "original"
  ) => string;
}

function ImageList({
  images,
  selectedImageIds,
  selectedImageId,
  onSelectImage,
  onToggleSelection,
  onDeleteImage,
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
}: ImageListProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-4">
        <table className="w-full">
          <thead className="border-b border-gray-800">
            <tr className="text-left text-sm text-gray-400">
              <th className="pb-2 w-8"></th>
              <th className="pb-2 w-12"></th>
              <th className="pb-2">Name</th>
              <th className="pb-2">Source</th>
              <th className="pb-2">Size</th>
              <th className="pb-2">Usage</th>
              <th className="pb-2">Uploaded</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {images.map((image) => (
              <tr
                key={image.id}
                className={cn(
                  "border-b border-gray-800 hover:bg-[#27272A] cursor-pointer transition-colors",
                  selectedImageId === image.id && "bg-[#00FF88]/10"
                )}
                onClick={() => onSelectImage(image.id)}
              >
                <td className="py-2">
                  <Checkbox
                    checked={selectedImageIds.has(image.id)}
                    onCheckedChange={() => onToggleSelection(image.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="py-2">
                  <div className="w-10 h-10 bg-gray-800 rounded overflow-hidden">
                    <LazyImage
                      src={getImageUrl(image, "thumb")}
                      alt={image.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </td>
                <td className="py-2 font-medium">{image.name}</td>
                <td className="py-2">
                  <Badge
                    className="text-xs"
                    style={{
                      backgroundColor: getSourceColor(image.source),
                      color: "black",
                    }}
                  >
                    {getSourceLabel(image.source)}
                  </Badge>
                </td>
                <td className="py-2 text-sm text-gray-400">
                  {formatFileSize(image.size)}
                </td>
                <td className="py-2">
                  <Badge
                    variant={image.usageCount > 0 ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {image.usageCount}x
                  </Badge>
                </td>
                <td className="py-2 text-sm text-gray-400">
                  {image.createdAt.toLocaleDateString()}
                </td>
                <td className="py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(image.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  );
}

// Image Details Panel
interface ImageDetailsPanelProps {
  image: ImageWithMetadata;
  usageDetails: Array<{
    workflowId: string;
    workflowName: string;
    stateId?: string;
    stateName?: string;
  }>;
  onClose: () => void;
  onDelete: () => void;
  onEditMask: () => void;
  formatFileSize: (bytes: number) => string;
  getSourceLabel: (source: string) => string;
  getSourceColor: (source: string) => string;
  getImageUrl: (
    image: ImageAsset,
    size?: "thumb" | "medium" | "original"
  ) => string;
}

function ImageDetailsPanel({
  image,
  usageDetails,
  onClose,
  onDelete,
  onEditMask,
  formatFileSize,
  getSourceLabel,
  getSourceColor,
  getImageUrl,
}: ImageDetailsPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h3 className="font-bold">Image Details</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Preview */}
          <div className="aspect-square bg-gray-800 rounded-lg overflow-hidden">
            <LazyImage
              src={getImageUrl(image, "original")}
              alt={image.name}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Name */}
          <div>
            <h4 className="text-lg font-bold">{image.name}</h4>
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400 flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                Size
              </span>
              <span>{formatFileSize(image.size)}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Uploaded
              </span>
              <span>{image.createdAt.toLocaleDateString()}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Source
              </span>
              <Badge
                style={{
                  backgroundColor: getSourceColor(image.source),
                  color: "black",
                }}
              >
                {getSourceLabel(image.source)}
              </Badge>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400 flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Usage
              </span>
              <Badge variant={image.usageCount > 0 ? "default" : "secondary"}>
                {image.usageCount}x
              </Badge>
            </div>
          </div>

          <Separator className="bg-gray-800" />

          {/* Usage Details */}
          {usageDetails.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Used In
              </h5>
              <div className="space-y-1">
                {usageDetails.map((usage, idx) => (
                  <div key={idx} className="text-sm p-2 bg-[#27272A] rounded">
                    {usage.stateName && (
                      <div className="flex items-center gap-2">
                        <Eye className="w-3 h-3 text-gray-400" />
                        <span>State: {usage.stateName}</span>
                      </div>
                    )}
                    {usage.workflowName && (
                      <div className="flex items-center gap-2">
                        <Link2 className="w-3 h-3 text-gray-400" />
                        <span>Workflow: {usage.workflowName}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-gray-700"
              onClick={onEditMask}
            >
              <Edit className="w-4 h-4 mr-2" />
              Edit Mask
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full border-gray-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="w-full border-red-700 text-red-400 hover:bg-red-900/20"
              onClick={onDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
