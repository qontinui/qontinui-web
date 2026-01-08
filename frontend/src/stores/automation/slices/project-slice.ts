/**
 * Project Slice
 *
 * Manages project metadata: name, ID, save state, categories.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, ProjectSlice, Category } from "../types";
import { projectLogger } from "@/lib/project-logger";

const DEFAULT_CATEGORIES: Category[] = [
  { name: "Main", automationEnabled: true },
  { name: "Incoming Transitions", automationEnabled: false },
  { name: "Outgoing Transitions", automationEnabled: false },
];

// Helper to get initial project ID from localStorage (browser only)
function getInitialProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("qontinui-selected-project-id");
}

// Helper to get initial project name from localStorage (browser only)
function getInitialProjectName(): string {
  if (typeof window === "undefined") return "Untitled Project";
  return localStorage.getItem("qontinui-project-name") || "Untitled Project";
}

export const createProjectSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  ProjectSlice
> = (set, get) => ({
  // Initial state - restore from localStorage if available
  projectName: getInitialProjectName(),
  projectId: getInitialProjectId(),
  lastSaved: null,
  isLoadingFromBackend: false,
  categories: [...DEFAULT_CATEGORIES],

  // Actions
  setProjectName: (name) => {
    projectLogger.debug("ProjectSlice", "setProjectName", { name });
    set((state) => {
      state.projectName = name;
    });
    // Sync to localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem("qontinui-project-name", name);
    }
  },

  setProjectId: (id) => {
    projectLogger.debug("ProjectSlice", "setProjectId", { id });
    set((state) => {
      state.projectId = id;
    });
    // Sync to localStorage
    if (typeof window !== "undefined") {
      if (id === null) {
        localStorage.removeItem("qontinui-selected-project-id");
      } else {
        localStorage.setItem("qontinui-selected-project-id", id);
      }
    }
  },

  setLastSaved: (timestamp) => {
    set((state) => {
      state.lastSaved = timestamp;
    });
    // Sync to localStorage
    if (typeof window !== "undefined") {
      if (timestamp === null) {
        localStorage.removeItem("qontinui-lastSaved");
      } else {
        localStorage.setItem("qontinui-lastSaved", timestamp);
      }
    }
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

  addCategory: (categoryName) => {
    const { categories } = get();
    if (!categories.some((c) => c.name === categoryName)) {
      projectLogger.debug("ProjectSlice", "addCategory", {
        category: categoryName,
      });
      set((state) => {
        // New categories are NOT automation-enabled by default
        state.categories.push({ name: categoryName, automationEnabled: false });
      });
    }
  },

  deleteCategory: (categoryName) => {
    // Protect default categories
    const defaultCategoryNames = DEFAULT_CATEGORIES.map((c) => c.name);
    if (defaultCategoryNames.includes(categoryName)) {
      projectLogger.warn("ProjectSlice", "Cannot delete protected category", {
        category: categoryName,
      });
      return;
    }

    projectLogger.debug("ProjectSlice", "deleteCategory", {
      category: categoryName,
    });
    set((state) => {
      state.categories = state.categories.filter(
        (c) => c.name !== categoryName
      );
    });
  },

  updateCategory: (category) => {
    projectLogger.debug("ProjectSlice", "updateCategory", { category });
    set((state) => {
      const index = state.categories.findIndex((c) => c.name === category.name);
      if (index !== -1) {
        state.categories[index] = category;
      }
    });
  },

  setCategories: (categories) => {
    projectLogger.debug("ProjectSlice", "setCategories", {
      count: categories.length,
    });
    set((state) => {
      state.categories = categories;
    });
  },
});
