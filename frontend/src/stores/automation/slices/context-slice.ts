/**
 * Context Slice
 *
 * Manages project contexts for AI prompt injection.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, ContextsSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";

export const createContextSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  ContextsSlice
> = (set, get) => ({
  // Initial state
  contexts: [],

  // Actions
  setContexts: (contexts) => {
    projectLogger.debug("ContextSlice", "setContexts", {
      count: contexts.length,
    });
    set((state) => {
      state.contexts = contexts;
    });
  },

  addContext: (context) => {
    projectLogger.debug("ContextSlice", "addContext", {
      id: context.id,
      name: context.name,
    });
    set((state) => {
      state.contexts.push(context);
    });
    get().triggerSave();
  },

  updateContext: (context) => {
    projectLogger.debug("ContextSlice", "updateContext", {
      id: context.id,
      name: context.name,
    });
    set((state) => {
      const index = state.contexts.findIndex((c) => c.id === context.id);
      if (index !== -1) {
        state.contexts[index] = context;
      }
    });
    get().triggerSave();
  },

  deleteContext: (contextId) => {
    projectLogger.debug("ContextSlice", "deleteContext", { contextId });
    set((state) => {
      state.contexts = state.contexts.filter((c) => c.id !== contextId);
    });
    get().triggerSave();
  },
});
