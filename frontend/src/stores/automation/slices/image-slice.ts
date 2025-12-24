/**
 * Image Slice
 *
 * Manages image assets including usage tracking and resolution helpers.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, ImageSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";

export const createImageSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  ImageSlice
> = (set, get) => ({
  // Initial state
  images: [],

  // Actions
  setImages: (images) => {
    projectLogger.debug("ImageSlice", "setImages", { count: images.length });
    set((state) => {
      state.images = images;
    });
  },

  addImage: (image) => {
    console.log("[ImageSlice] addImage called:", {
      id: image.id,
      name: image.name,
      hasUrl: !!image.url,
      hasMask: !!image.mask,
      projectName: image.projectName,
    });
    projectLogger.info("ImageSlice", "addImage", {
      id: image.id,
      name: image.name,
    });
    set((state) => {
      // Use the image's projectName if provided, otherwise fall back to state.projectName
      // This ensures the image is associated with the correct project even if
      // Zustand's projectName hasn't been synced yet
      state.images.push({
        ...image,
        projectName: image.projectName || state.projectName,
      });
      console.log("[ImageSlice] addImage complete - new images count:", state.images.length);
    });
    get().triggerSave();
  },

  updateImage: (image) => {
    projectLogger.debug("ImageSlice", "updateImage", { id: image.id });
    set((state) => {
      const index = state.images.findIndex((i) => i.id === image.id);
      if (index !== -1) {
        state.images[index] = image;
      }
    });
    get().triggerSave();
  },

  deleteImage: (imageId) => {
    projectLogger.info("ImageSlice", "deleteImage", { imageId });
    set((state) => {
      const index = state.images.findIndex((i) => i.id === imageId);
      if (index !== -1) {
        state.images.splice(index, 1);
      }
    });
    get().triggerSave();
  },

  updateImageUsage: (imageId, usage) => {
    projectLogger.debug("ImageSlice", "updateImageUsage", { imageId, usage });
    set((state) => {
      const img = state.images.find((i) => i.id === imageId);
      if (img) {
        const existingUsage = img.usage?.find((u) => u.id === usage.id);
        if (existingUsage) {
          const usageIndex = img.usage!.findIndex((u) => u.id === usage.id);
          img.usage![usageIndex] = usage;
        } else {
          img.usage = [...(img.usage || []), usage];
        }
        img.usageCount = img.usage!.length;
      }
    });
  },

  removeImageUsage: (imageId, usageId) => {
    projectLogger.debug("ImageSlice", "removeImageUsage", { imageId, usageId });
    set((state) => {
      const img = state.images.find((i) => i.id === imageId);
      if (img && img.usage) {
        img.usage = img.usage.filter((u) => u.id !== usageId);
        img.usageCount = img.usage.length;
      }
    });
  },

  // Helpers
  getImageById: (imageId) => {
    if (!imageId) return null;
    return get().images.find((i) => i.id === imageId) || null;
  },

  getImageUsage: (imageId) => {
    const { states, workflows } = get();
    const stateUsages: Array<{ id: string; name: string }> = [];
    const processUsages: Array<{
      id: string;
      name: string;
      actionCount: number;
    }> = [];

    // Check states for image usage
    states.forEach((state) => {
      const usesImage = state.stateImages.some((si) =>
        si.patterns.some((p) => p.imageId === imageId)
      );
      if (usesImage) {
        stateUsages.push({ id: state.id, name: state.name });
      }
    });

    // Check workflows for image usage in actions
    workflows.forEach((workflow) => {
      let actionCount = 0;
      workflow.actions.forEach((action) => {
        // Check if action references this image (in config.imageId or similar)
        const config = action.config as Record<string, unknown>;
        if (config?.imageId === imageId) {
          actionCount++;
        }
      });
      if (actionCount > 0) {
        processUsages.push({
          id: workflow.id,
          name: workflow.name,
          actionCount,
        });
      }
    });

    return { states: stateUsages, processes: processUsages };
  },

  resolvePatternImage: (pattern) => {
    if (!pattern.imageId) {
      console.log("[ImageSlice] resolvePatternImage: No imageId in pattern", {
        patternId: pattern.id,
        patternName: pattern.name,
      });
      return null;
    }
    const image = get().getImageById(pattern.imageId);
    if (!image) {
      console.log("[ImageSlice] resolvePatternImage: Image not found", {
        patternId: pattern.id,
        patternImageId: pattern.imageId,
        availableImageIds: get().images.map((i) => i.id),
      });
      return null;
    }
    return { url: image.url, mask: image.mask };
  },
});
