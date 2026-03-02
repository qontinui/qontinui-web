import { useState, useRef } from "react";
import { type UploadingImage } from "@/components/ImageUploadProgress";
import { Screenshot } from "../../../types/Screenshot";
import { apiClient } from "@/lib/api-client";
import { normalizeUrl } from "@/lib/screenshot-db";
import { toast } from "sonner";

interface UseScreenshotUploadOptions {
  projectId: string | null;
  projectName: string;
  addScreenshot: (screenshot: {
    id: string;
    name: string;
    url: string;
    size: number;
    uploadedAt: Date;
    projectName: string;
  }) => void;
  selectedScreenshot: Screenshot | null;
  setSelectedScreenshot: (s: Screenshot | null) => void;
  handleAutoSave: () => void;
}

export function useScreenshotUpload({
  projectId,
  projectName,
  addScreenshot,
  selectedScreenshot,
  setSelectedScreenshot,
  handleAutoSave,
}: UseScreenshotUploadOptions) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!projectId) {
      toast.error("No project selected", {
        description: "Please open a project before uploading screenshots.",
      });
      return;
    }

    const fileArray = Array.from(files);

    const invalidFiles = fileArray.filter(
      (file) => !file.type.startsWith("image/")
    );
    if (invalidFiles.length > 0) {
      toast.error("Invalid file type", {
        description: `${invalidFiles[0]?.name ?? "Unknown file"} is not an image file.`,
      });
      return;
    }

    const initialUploading: UploadingImage[] = [];
    fileArray.forEach((file) => {
      initialUploading.push({ name: file.name, progress: 0 });
    });
    setUploadingFiles(initialUploading);

    for (const file of fileArray) {
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new window.Image();
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

        const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
        const result = await apiClient.uploadProjectScreenshot(
          parseInt(projectId ?? "0", 10),
          file,
          nameWithoutExtension,
          "manual_upload",
          undefined,
          (progress: number) => {
            setUploadingFiles((prev: UploadingImage[]) =>
              prev.map((f) => (f.name === file.name ? { ...f, progress } : f))
            );
          }
        );

        const screenshotUrl = result.presigned_url;
        if (!screenshotUrl) {
          console.error("Upload response missing URL:", result);
          throw new Error("Upload succeeded but no URL was returned");
        }
        const screenshot = {
          id: result.id,
          name: result.name,
          url: normalizeUrl(screenshotUrl),
          size: result.file_size,
          uploadedAt: new Date(result.created_at),
          projectName: projectName,
        };

        addScreenshot(screenshot);

        toast.success(`${file.name} uploaded successfully`);

        handleAutoSave();

        if (!selectedScreenshot) {
          const img = new window.Image();
          img.onload = () => {
            setSelectedScreenshot({
              id: screenshot.id,
              name: screenshot.name,
              imageData: screenshot.url,
              width: img.width,
              height: img.height,
              uploadedAt: screenshot.uploadedAt,
              associatedStates: [],
              regions: [],
              locations: [],
            });
          };
          img.src = screenshot.url;
        }

        setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
      } catch (error: unknown) {
        console.error(`Upload failed for ${file.name}:`, error);

        const errorMsg = error instanceof Error ? error.message : String(error);
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
            description: "Please check your internet connection and try again.",
          });
        } else {
          toast.error(`Failed to upload ${file.name}`, {
            description: errorMsg,
          });
        }

        setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
      }
    }

    if (event.target) {
      event.target.value = "";
    }
  };

  return {
    uploadingFiles,
    setUploadingFiles,
    fileInputRef,
    handleFileUpload,
  };
}
