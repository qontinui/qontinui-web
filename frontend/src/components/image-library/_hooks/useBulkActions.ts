import { useCallback } from "react";
import { toast } from "sonner";
import type { ImageAsset } from "@/contexts/automation-context/types";
import type { ImageWithMetadata } from "../types";

interface UseBulkActionsOptions {
  images: ImageWithMetadata[];
  selectedImageIds: Set<string>;
  updateImage: (image: ImageAsset) => void;
  deleteImage: (imageId: string) => void;
  addImagesToCollection: (collectionId: string, imageIds: string[]) => void;
  clearSelection: () => void;
}

export function useBulkActions({
  images,
  selectedImageIds,
  updateImage,
  deleteImage,
  addImagesToCollection,
  clearSelection,
}: UseBulkActionsOptions) {
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

  return {
    handleBulkMove,
    handleBulkAddToCollection,
    handleBulkDelete,
  };
}
