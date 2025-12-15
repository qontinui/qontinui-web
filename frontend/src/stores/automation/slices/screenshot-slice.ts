/**
 * Screenshot Slice
 *
 * Manages screenshots including backend synchronization.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, ScreenshotSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";
import { apiClient } from "@/lib/api-client";

export const createScreenshotSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  ScreenshotSlice
> = (set, get) => ({
  // Initial state
  screenshots: [],

  // Actions
  setScreenshots: (screenshots) => {
    projectLogger.debug("ScreenshotSlice", "setScreenshots", {
      count: screenshots.length,
    });
    set((state) => {
      state.screenshots = screenshots;
    });
  },

  addScreenshot: (screenshot) => {
    projectLogger.info("ScreenshotSlice", "addScreenshot", {
      id: screenshot.id,
      name: screenshot.name,
    });
    set((state) => {
      state.screenshots.push({
        ...screenshot,
        projectName: state.projectName,
      });
    });
    get().triggerSave();
  },

  updateScreenshot: (screenshot) => {
    projectLogger.debug("ScreenshotSlice", "updateScreenshot", {
      id: screenshot.id,
    });
    set((state) => {
      const index = state.screenshots.findIndex((s) => s.id === screenshot.id);
      if (index !== -1) {
        state.screenshots[index] = screenshot;
      }
    });
    get().triggerSave();
  },

  deleteScreenshot: (screenshotId) => {
    projectLogger.info("ScreenshotSlice", "deleteScreenshot", { screenshotId });
    set((state) => {
      const index = state.screenshots.findIndex((s) => s.id === screenshotId);
      if (index !== -1) {
        state.screenshots.splice(index, 1);
      }
    });
    get().triggerSave();
  },

  syncScreenshotsFromBackend: async (projectId) => {
    projectLogger.info("ScreenshotSlice", "syncScreenshotsFromBackend", {
      projectId,
    });

    try {
      const response = await apiClient.listProjectScreenshots(projectId);

      if (response.screenshots) {
        const { projectName, screenshots: existingScreenshots } = get();

        // Merge backend screenshots with local ones
        const mergedScreenshots = [...existingScreenshots];

        response.screenshots.forEach((backendScreenshot) => {
          const existingIndex = mergedScreenshots.findIndex(
            (s) => s.id === backendScreenshot.id
          );
          if (existingIndex === -1) {
            // Add new screenshot from backend
            mergedScreenshots.push({
              id: backendScreenshot.id,
              name: backendScreenshot.name,
              url: backendScreenshot.presigned_url,
              size: backendScreenshot.file_size,
              uploadedAt: new Date(backendScreenshot.created_at),
              description: backendScreenshot.name,
              projectName,
            });
          } else {
            // Update existing screenshot with backend data (e.g., presigned URL)
            const existing = mergedScreenshots[existingIndex]!;
            mergedScreenshots[existingIndex] = {
              id: existing.id,
              name: existing.name,
              url: backendScreenshot.presigned_url,
              size: existing.size,
              uploadedAt: existing.uploadedAt,
              description: existing.description,
              projectName,
            };
          }
        });

        set((state) => {
          state.screenshots = mergedScreenshots;
        });

        projectLogger.info(
          "ScreenshotSlice",
          "Screenshots synced from backend",
          {
            count: response.screenshots.length,
          }
        );
      }
    } catch (error) {
      projectLogger.error("ScreenshotSlice", "Failed to sync screenshots", {
        error,
      });
      throw error;
    }
  },
});
