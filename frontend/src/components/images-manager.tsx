"use client";

import type React from "react";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MaskEditor } from "@/components/mask-editor";
import { Upload, ImageIcon, Trash2, Search, X, Edit } from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import {
  ImageDeletionDialog,
  type ImageUsageInfo,
} from "@/components/image-deletion-dialog";
import { uploadScreenshotOffline } from "@/lib/offline-screenshot-upload";
import {
  ImageUploadProgress,
  type UploadingImage,
} from "@/components/ImageUploadProgress";

import type { ImageAsset } from "@/contexts/automation-context";

export function ImagesManager() {
  const {
    images,
    addImage,
    deleteImage,
    updateImage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
    projectName,
    projectId,
  } = useAutomation();
  const [searchQuery, setSearchQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [editingImage, setEditingImage] = useState<ImageAsset | null>(null);
  const [showDeletionDialog, setShowDeletionDialog] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<ImageAsset | null>(null);
  const [deletionUsageInfo, setDeletionUsageInfo] = useState<ImageUsageInfo>({
    states: [],
    processes: [],
  });
  const [uploadingFiles, setUploadingFiles] = useState<UploadingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Count images by source
  const imageCounts = {
    all: images.length,
    uploaded: images.filter((img) => img.source === "uploaded").length,
    pattern_optimization: images.filter(
      (img) => img.source === "pattern_optimization"
    ).length,
    image_extraction: images.filter((img) => img.source === "image_extraction")
      .length,
    state_discovery: images.filter((img) => img.source === "state_discovery")
      .length,
  };

  // Filter images by search query and source
  const filteredImages = images.filter((image) => {
    const matchesSearch = image.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesSource = !activeFilter || image.source === activeFilter;
    return matchesSearch && matchesSource;
  });

  const handleFiles = useCallback(
    async (files: FileList) => {
      // Validate projectId is available
      if (!projectId) {
        toast.error("No project selected", {
          description: "Please open a project before uploading images.",
        });
        return;
      }

      const fileArray = Array.from(files);

      // Validate file types before upload
      const invalidFiles = fileArray.filter(
        (file) => !file.type.startsWith("image/")
      );
      if (invalidFiles.length > 0) {
        toast.error("Invalid file type", {
          description: `${invalidFiles[0]?.name ?? "Unknown file"} is not an image file.`,
        });
        return;
      }

      // Initialize upload progress for all files
      const initialUploading: UploadingImage[] = [];
      fileArray.forEach((file) => {
        initialUploading.push({ name: file.name, progress: 0 });
      });
      setUploadingFiles(initialUploading);

      // Upload all files concurrently (with progress tracking)
      const uploadPromises = fileArray.map(async (file) => {
        try {
          // Validate image before uploading
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (e) => {
              img.onload = () => {
                if (img.width < 10 || img.height < 10) {
                  reject(
                    new Error(
                      `Image too small: ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`
                    )
                  );
                } else {
                  resolve();
                }
              };
              img.onerror = () => reject(new Error("Failed to load image"));
              img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          });

          // Upload with offline-first support
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

          // Create ImageAsset with local data (available immediately)
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
            // S3 fields (matching ImageAsset type in context)
            s3_key: result.screenshot.s3Key,
            url_expires_at: result.screenshot.urlExpiresAt,
          };

          // Add to context immediately
          addImage(imageAsset);

          toast.success(`${file.name} uploaded`);

          // Remove from uploading list
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
        } catch (error: unknown) {
          console.error(`Upload failed for ${file.name}:`, error);

          // Show user-friendly error message
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error occurred";
          if (errorMsg.includes("quota") || errorMsg.includes("Quota")) {
            toast.error("Storage quota exceeded", {
              description: "Please upgrade your plan or delete unused images.",
            });
          } else if (errorMsg.includes("too small")) {
            toast.error("Image too small", {
              description: errorMsg,
            });
          } else if (
            errorMsg.includes("Network error") ||
            errorMsg.includes("timeout")
          ) {
            toast.error("Network error", {
              description:
                "Please check your internet connection and try again.",
            });
          } else {
            toast.error(`Failed to upload ${file.name}`, {
              description: errorMsg,
            });
          }

          // Remove from uploading list
          setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));

          return { success: false, fileName: file.name, error: errorMsg };
        }
      });

      // Wait for all uploads to complete
      const results = await Promise.all(uploadPromises);
      const successCount = results.filter((r) => r.success).length;

      if (successCount > 0) {
        toast.success("Upload complete", {
          description: `${successCount} image(s) added to your library.`,
        });
      }
    },
    [addImage, projectName, projectId]
  );

  const handleDeleteImage = (imageId: string) => {
    const image = images.find((img) => img.id === imageId);
    if (!image) {
      toast.error("Image not found");
      return;
    }

    // Get usage information
    const usageInfo = getImageUsage(imageId);
    setImageToDelete(image);
    setDeletionUsageInfo(usageInfo);
    setShowDeletionDialog(true);
  };

  const confirmDelete = async () => {
    if (!imageToDelete) return;

    try {
      // Perform cascade deletion
      const statesAffected = await removeImageFromStates(imageToDelete.url);
      const processesAffected = await markImageAsRemovedInProcesses(
        imageToDelete.id,
        imageToDelete.name
      );

      // Delete the image from the library
      deleteImage(imageToDelete.id);

      // Show success message
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

      // Reset state
      setImageToDelete(null);
      setDeletionUsageInfo({ states: [], processes: [] });
    } catch (error) {
      toast.error("Failed to delete image", {
        description: "An error occurred while deleting the image.",
      });
      console.error("Delete image error:", error);
    }
  };

  const handleEditMask = (image: ImageAsset) => {
    setEditingImage(image);
    setShowMaskEditor(true);
  };

  const handleSaveMask = (maskedImage: string, mask: string) => {
    if (!editingImage) return;

    const updatedImage: ImageAsset = {
      ...editingImage,
      url: maskedImage,
      mask: mask, // Store the separate mask image
    };

    updateImage(updatedImage);
    setShowMaskEditor(false);
    setEditingImage(null);
    toast.success("Mask applied to image", {
      description: "The image has been updated with the new mask.",
    });
  };

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
        return "hsl(var(--brand-success))";
      case "pattern_optimization":
        return "hsl(var(--brand-primary))";
      case "image_extraction":
        return "hsl(var(--brand-secondary))";
      case "state_discovery":
        return "hsl(var(--brand-warning))";
      default:
        return "hsl(var(--text-muted))";
    }
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* Upload Progress Indicator */}
      <ImageUploadProgress uploads={uploadingFiles} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">Library</h2>

          {/* Stats - moved next to title */}
          {images.length > 0 && (
            <div className="flex gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
                <span className="text-xs text-text-muted">Total Images:</span>
                <span className="text-sm font-bold text-brand-success">
                  {images.length}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
                <span className="text-xs text-text-muted">Total Usage:</span>
                <span className="text-sm font-bold text-brand-primary">
                  {images.reduce((acc, img) => acc + img.usageCount, 0)}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
                <span className="text-xs text-text-muted">Total Size:</span>
                <span className="text-sm font-bold text-brand-secondary">
                  {formatFileSize(
                    images.reduce((acc, img) => acc + img.size, 0)
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              placeholder="Search images..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64 bg-transparent border-border-default focus:border-brand-success"
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
            className="bg-brand-success hover:bg-brand-success/80 text-black"
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
                ? "bg-brand-success text-black border-brand-success"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setActiveFilter(null)}
          >
            All ({imageCounts.all})
          </Badge>
          <Badge
            variant={activeFilter === "uploaded" ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === "uploaded"
                ? "bg-brand-success text-black border-brand-success"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setActiveFilter("uploaded")}
          >
            Uploaded ({imageCounts.uploaded})
          </Badge>
          <Badge
            variant={
              activeFilter === "pattern_optimization" ? "default" : "outline"
            }
            className={`cursor-pointer transition-all ${
              activeFilter === "pattern_optimization"
                ? "bg-brand-primary text-black border-brand-primary"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setActiveFilter("pattern_optimization")}
          >
            Pattern Opt ({imageCounts.pattern_optimization})
          </Badge>
          <Badge
            variant={
              activeFilter === "image_extraction" ? "default" : "outline"
            }
            className={`cursor-pointer transition-all ${
              activeFilter === "image_extraction"
                ? "bg-brand-secondary text-black border-brand-secondary"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setActiveFilter("image_extraction")}
          >
            Extraction ({imageCounts.image_extraction})
          </Badge>
          <Badge
            variant={activeFilter === "state_discovery" ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              activeFilter === "state_discovery"
                ? "bg-brand-warning text-black border-brand-warning"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setActiveFilter("state_discovery")}
          >
            Discovery ({imageCounts.state_discovery})
          </Badge>
        </div>
      )}

      {/* Upload Area */}
      <Card
        className={`border-2 border-dashed transition-colors ${
          dragActive
            ? "border-brand-success bg-brand-success/10"
            : "border-border-default bg-surface-raised/50 hover:border-border-subtle"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="p-12">
          <div className="text-center">
            <Upload
              className={`w-12 h-12 mx-auto mb-4 ${dragActive ? "text-brand-success" : "text-text-muted"}`}
            />
            <p className="text-lg mb-2">Drag & drop images here</p>
            <p className="text-sm text-text-muted mb-4">
              or click to browse files
            </p>
            <Button
              variant="outline"
              className="border-border-subtle bg-transparent hover:border-brand-success hover:text-brand-success"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Files
            </Button>
          </div>
        </CardContent>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Image Gallery */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
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
              <p className="text-sm">
                Upload images to use in your automation workflows
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-6 md:grid-cols-8 lg:grid-cols-12 xl:grid-cols-16 gap-2">
          {filteredImages.map((image) => (
            <Card
              key={image.id}
              className="border-border-default bg-surface-raised hover:border-border-subtle transition-colors group"
            >
              <CardContent className="p-1">
                <div className="space-y-1">
                  {/* Image Preview - reduced by 50% */}
                  <div className="aspect-square bg-surface-canvas rounded overflow-hidden relative w-20 h-20">
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
                    <h4
                      className="font-medium text-[10px] truncate"
                      title={image.name}
                    >
                      {image.name}
                    </h4>

                    <div className="flex items-center justify-between text-[8px] text-text-muted">
                      <span>{formatFileSize(image.size)}</span>
                    </div>

                    <div className="flex items-center justify-between gap-0.5">
                      <Badge
                        variant={image.usageCount > 0 ? "default" : "secondary"}
                        className={`text-[8px] px-0.5 py-0 h-3 ${
                          image.usageCount > 0
                            ? "bg-brand-success text-black"
                            : "bg-surface-raised text-text-muted"
                        }`}
                      >
                        {image.usageCount}x
                      </Badge>
                      <Badge
                        className="text-[8px] px-0.5 py-0 h-3"
                        style={{
                          backgroundColor: getSourceColor(image.source),
                          color: "black",
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
          initialMask={editingImage.mask || undefined}
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
