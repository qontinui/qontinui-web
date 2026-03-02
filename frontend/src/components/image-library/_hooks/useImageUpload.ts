import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { UploadingImage } from "@/components/ImageUploadProgress";
import { uploadScreenshotOffline } from "@/lib/offline-screenshot-upload";
import type { ImageWithMetadata } from "../types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ImageLibrary.upload");

interface UseImageUploadOptions {
  projectId: string | number | null;
  projectName?: string;
  selectedFolderId: string | null;
  uploadMonitors: number[];
  addImage: (image: ImageAsset) => void;
}

export function useImageUpload({
  projectId,
  projectName,
  selectedFolderId,
  uploadMonitors,
  addImage,
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

  return {
    dragActive,
    uploadingFiles,
    fileInputRef,
    handleDrag,
    handleDrop,
    handleFileInput,
  };
}
