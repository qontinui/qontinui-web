/**
 * Cross-Entity Middleware
 *
 * Handles cascade operations when entities are deleted or modified.
 * For example, deleting an image should update states that reference it.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore } from "../types";
import { projectLogger } from "@/lib/project-logger";

/**
 * Cross-entity operations that are added to the store
 */
export interface CrossEntityOperations {
  removeImageFromStates: (imageUrl: string) => Promise<number>;
  markImageAsRemovedInProcesses: (
    imageId: string,
    imageName: string
  ) => Promise<number>;
}

/**
 * Create cross-entity operations slice
 */
export const createCrossEntitySlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  CrossEntityOperations
> = (set, _get) => ({
  /**
   * Remove image references from all states
   * Returns the number of states modified
   */
  removeImageFromStates: async (imageUrl) => {
    projectLogger.info("CrossEntity", "removeImageFromStates", { imageUrl });

    let modifiedCount = 0;

    set((state) => {
      state.states.forEach((s) => {
        s.stateImages.forEach((si) => {
          const beforeCount = si.patterns.length;
          si.patterns = si.patterns.filter((p) => {
            // Check if pattern references this image
            const image = state.images.find((i) => i.id === p.imageId);
            return image?.url !== imageUrl;
          });
          if (si.patterns.length !== beforeCount) {
            modifiedCount++;
          }
        });
      });
    });

    projectLogger.info("CrossEntity", "removeImageFromStates complete", {
      modifiedCount,
    });
    return modifiedCount;
  },

  /**
   * Mark image as removed in workflow action configurations
   * Returns the number of workflows modified
   */
  markImageAsRemovedInProcesses: async (imageId, imageName) => {
    projectLogger.info("CrossEntity", "markImageAsRemovedInProcesses", {
      imageId,
      imageName,
    });

    let modifiedCount = 0;

    set((state) => {
      state.workflows.forEach((workflow) => {
        workflow.actions.forEach((action) => {
          const config = action.config as Record<string, unknown>;
          if (config?.imageId === imageId) {
            // Mark the image as removed by updating the config
            config.imageId = undefined;
            config.removedImageName = imageName;
            config.removedImageId = imageId;
            modifiedCount++;
          }
        });
      });
    });

    projectLogger.info("CrossEntity", "markImageAsRemovedInProcesses complete", {
      modifiedCount,
    });
    return modifiedCount;
  },
});
