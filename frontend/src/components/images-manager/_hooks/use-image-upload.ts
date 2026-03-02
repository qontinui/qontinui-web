"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useAutomation, type ImageAsset } from "@/contexts/automation-context";
import { uploadScreenshotOffline } from "@/lib/offline-screenshot-upload";
import type { UploadingImage } from "@/components/ImageUploadProgress";

export function useImageUpload() {
  const { addImage, projectName, projectId } = useAutomation();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const [dragActive, setDragActive] = useState(false);

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
    uploadingFiles,
    fileInputRef,
    dragActive,
    handleDrag,
    handleDrop,
    handleFileInput,
  };
}
