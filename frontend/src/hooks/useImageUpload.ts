import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { UploadingImage } from "@/components/ImageUploadProgress";
import { uploadScreenshotOffline } from "@/lib/offline-screenshot-upload";
import { createLogger } from "@/lib/logger";

const logger = createLogger("useImageUpload");

export interface UseImageUploadOptions {
  /** Project ID (required for upload). Upload is rejected if null. */
  projectId: string | number | null;
  /** Project name attached to uploaded ImageAsset metadata. */
  projectName?: string;
  /** Callback invoked with each newly-created ImageAsset (and again after server sync). */
  addImage: (image: ImageAsset) => void;
  /** Optional folder ID assigned to uploaded images. */
  selectedFolderId?: string | null;
  /** Optional monitor indices attached to uploaded images. */
  uploadMonitors?: number[];
}

/**
 * Shared hook for image uploading with drag-and-drop, progress tracking,
 * offline-first support, and categorized error toasts.
 */
export function useImageUpload({
  projectId,
  projectName,
  addImage,
  selectedFolderId,
  uploadMonitors,
}: UseImageUploadOptions) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          // Validate image dimensions before uploading
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
            ...(uploadMonitors ? { monitors: uploadMonitors } : {}),
            ...(selectedFolderId ? { folderId: selectedFolderId } : {}),
          };

          addImage(imageAsset);
          toast.success(`${file.name} uploaded`);

          setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));

          // Wait for server sync in background
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

          // Categorized error toasts
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

          setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
          return { success: false, fileName: file.name, error: errorMsg };
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
    [projectId, projectName, selectedFolderId, uploadMonitors, addImage]
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

  return {
    dragActive,
    uploadingFiles,
    fileInputRef,
    handleDrag,
    handleDrop,
    handleFileInput,
  };
}
