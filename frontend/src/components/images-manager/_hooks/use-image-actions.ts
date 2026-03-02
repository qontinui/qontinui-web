"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAutomation, type ImageAsset } from "@/contexts/automation-context";
import type { ImageUsageInfo } from "@/components/image-deletion-dialog";

export function useImageActions() {
  const {
    images,
    deleteImage,
    updateImage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
  } = useAutomation();

  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [editingImage, setEditingImage] = useState<ImageAsset | null>(null);
  const [showDeletionDialog, setShowDeletionDialog] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<ImageAsset | null>(null);
  const [deletionUsageInfo, setDeletionUsageInfo] = useState<ImageUsageInfo>({
    states: [],
    processes: [],
  });

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

  const closeMaskEditor = () => {
    setShowMaskEditor(false);
    setEditingImage(null);
  };

  return {
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
