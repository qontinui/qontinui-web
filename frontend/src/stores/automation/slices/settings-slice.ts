/**
 * Settings Slice
 *
 * Manages project settings.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, SettingsSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";
import { DEFAULT_PROJECT_SETTINGS } from "@/types/project-settings";

export const createSettingsSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  SettingsSlice
> = (set, get) => ({
  // Initial state
  settings: DEFAULT_PROJECT_SETTINGS,

  // Actions
  setSettings: (settings) => {
    projectLogger.debug("SettingsSlice", "setSettings");
    set((state) => {
      state.settings = settings;
    });
  },

  updateSettings: (partialSettings) => {
    projectLogger.debug("SettingsSlice", "updateSettings", {
      keys: Object.keys(partialSettings),
    });
    set((state) => {
      state.settings = {
        ...state.settings,
        ...partialSettings,
      };
    });
    get().triggerSave();
  },
});
