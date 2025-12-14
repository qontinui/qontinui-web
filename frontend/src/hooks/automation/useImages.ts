/**
 * useImages Hook
 *
 * Hook for image asset operations including usage tracking.
 */

import { useAutomationStore } from "@/stores/automation";

export function useImages() {
  // State
  const images = useAutomationStore((s) => s.images);

  // Actions
  const setImages = useAutomationStore((s) => s.setImages);
  const addImage = useAutomationStore((s) => s.addImage);
  const updateImage = useAutomationStore((s) => s.updateImage);
  const deleteImage = useAutomationStore((s) => s.deleteImage);
  const updateImageUsage = useAutomationStore((s) => s.updateImageUsage);
  const removeImageUsage = useAutomationStore((s) => s.removeImageUsage);

  // Helpers
  const getImageById = useAutomationStore((s) => s.getImageById);
  const getImageUsage = useAutomationStore((s) => s.getImageUsage);
  const resolvePatternImage = useAutomationStore((s) => s.resolvePatternImage);

  // Cross-entity operations
  const removeImageFromStates = useAutomationStore(
    (s) => s.removeImageFromStates
  );
  const markImageAsRemovedInProcesses = useAutomationStore(
    (s) => s.markImageAsRemovedInProcesses
  );

  return {
    // State
    images,

    // CRUD
    setImages,
    addImage,
    updateImage,
    deleteImage,
    updateImageUsage,
    removeImageUsage,

    // Helpers
    getImageById,
    getImageUsage,
    resolvePatternImage,

    // Cross-entity
    removeImageFromStates,
    markImageAsRemovedInProcesses,
  };
}
