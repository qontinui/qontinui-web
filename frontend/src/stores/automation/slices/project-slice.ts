/**
 * Project Slice
 *
 * Manages project metadata: name, ID, save state, categories.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, ProjectSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";

const DEFAULT_CATEGORIES = ["Main", "Incoming Transitions", "Outgoing Transitions"];

export const createProjectSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  ProjectSlice
> = (set, get) => ({
  // Initial state
  projectName: "Untitled Project",
  projectId: null,
  lastSaved: null,
  isLoadingFromBackend: false,
  categories: [...DEFAULT_CATEGORIES],

  // Actions
  setProjectName: (name) => {
    projectLogger.debug("ProjectSlice", "setProjectName", { name });
    set((state) => {
      state.projectName = name;
    });
  },

  setProjectId: (id) => {
    projectLogger.debug("ProjectSlice", "setProjectId", { id });
    set((state) => {
      state.projectId = id;
    });
  },

  setLastSaved: (timestamp) => {
    set((state) => {
      state.lastSaved = timestamp;
    });
  },

  setIsLoadingFromBackend: (loading) => {
    projectLogger.debug("ProjectSlice", "setIsLoadingFromBackend", { loading });
    set((state) => {
      state.isLoadingFromBackend = loading;
    });
  },

  triggerSave: () => {
    const timestamp = new Date().toISOString();
    projectLogger.debug("ProjectSlice", "triggerSave", { timestamp });
    set((state) => {
      state.lastSaved = timestamp;
    });
  },

  renameProject: async (newName) => {
    const oldName = get().projectName;
    projectLogger.info("ProjectSlice", "renameProject", { oldName, newName });

    // Update project name
    set((state) => {
      state.projectName = newName;
    });

    // Update projectName in all entities
    set((state) => {
      state.states.forEach((s) => {
        s.projectName = newName;
      });
      state.transitions.forEach((t) => {
        t.projectName = newName;
      });
      state.images.forEach((i) => {
        i.projectName = newName;
      });
      state.screenshots.forEach((s) => {
        s.projectName = newName;
      });
      state.schedules.forEach((s) => {
        s.projectName = newName;
      });
    });

    // Trigger save to persist
    get().triggerSave();
  },

  addCategory: (category) => {
    const { categories } = get();
    if (!categories.includes(category)) {
      projectLogger.debug("ProjectSlice", "addCategory", { category });
      set((state) => {
        state.categories.push(category);
      });
    }
  },

  deleteCategory: (category) => {
    // Protect default categories
    if (DEFAULT_CATEGORIES.includes(category)) {
      projectLogger.warn("ProjectSlice", "Cannot delete protected category", {
        category,
      });
      return;
    }

    projectLogger.debug("ProjectSlice", "deleteCategory", { category });
    set((state) => {
      state.categories = state.categories.filter((c) => c !== category);
    });
  },
});
