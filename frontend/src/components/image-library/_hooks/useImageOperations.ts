import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { ImageUsageInfo } from "@/components/image-deletion-dialog";
import type { ImageWithMetadata } from "../types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ImageLibrary.operations");

interface UseImageOperationsOptions {
  images: ImageWithMetadata[];
  getImageUsage: (imageId: string) => ImageUsageInfo;
  removeImageFromStates: (imageUrl: string) => Promise<number>;
  markImageAsRemovedInProcesses: (
    imageId: string,
    imageName: string
  ) => Promise<number>;
  deleteImage: (imageId: string) => void;
  updateImage: (image: ImageAsset) => void;
}

export function useImageOperations({
  images,
  getImageUsage,
  removeImageFromStates,
  markImageAsRemovedInProcesses,
  deleteImage,
  updateImage,
}: UseImageOperationsOptions) {
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [editingImage, setEditingImage] = useState<ImageAsset | null>(null);
  const [showDeletionDialog, setShowDeletionDialog] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<ImageAsset | null>(null);
  const [deletionUsageInfo, setDeletionUsageInfo] = useState<ImageUsageInfo>({
    states: [],
    processes: [],
  });
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

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

  const closeMaskEditor = useCallback(() => {
    setShowMaskEditor(false);
    setEditingImage(null);
  }, []);

  return {
    selectedImageId,
    setSelectedImageId,
    showMaskEditor,
    editingImage,
    showDeletionDialog,
    setShowDeletionDialog,
    imageToDelete,
    deletionUsageInfo,
    handleDeleteImage,
    confirmDelete,
    handleEditMask,
    handleSaveMask,
    closeMaskEditor,
  };
}
