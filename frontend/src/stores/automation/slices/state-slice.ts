/**
 * State Slice
 *
 * Manages automation states including action history and RAG embeddings.
 */

import type { StateCreator } from "zustand";
import type { AutomationStore, StateSlice } from "../types";
import { projectLogger } from "@/lib/project-logger";
import { StateUpdateCoordinator } from "@/stores/automation";

export const createStateSlice: StateCreator<
  AutomationStore,
  [["zustand/immer", never]],
  [],
  StateSlice
> = (set, get) => ({
  // Initial state
  states: [],

  // Actions
  setStates: (states) => {
    projectLogger.debug("StateSlice", "setStates", { count: states.length });
    set((state) => {
      state.states = states;
    });
  },

  addState: (newState) => {
    console.log("[StateSlice] addState called:", {
      id: newState.id,
      name: newState.name,
      position: newState.position,
      projectName: newState.projectName,
      stateImagesCount: newState.stateImages?.length || 0,
    });
    projectLogger.info("StateSlice", "addState", {
      id: newState.id,
      name: newState.name,
    });
    set((state) => {
      // Use the state's projectName if provided, otherwise fall back to store's projectName
      // This ensures the state is associated with the correct project even if
      // Zustand's projectName hasn't been synced yet
      const stateToAdd = {
        ...newState,
        projectName: newState.projectName || state.projectName,
      };
      state.states.push(stateToAdd);
      console.log(
        "[StateSlice] addState complete - new state count:",
        state.states.length
      );
    });
    get().triggerSave();
  },

  updateState: (updatedState) => {
    projectLogger.debug("StateSlice", "updateState", {
      id: updatedState.id,
      name: updatedState.name,
    });
    set((state) => {
      const index = state.states.findIndex((s) => s.id === updatedState.id);
      if (index !== -1) {
        state.states[index] = updatedState;
      }
    });
    get().triggerSave();
  },

  updateStateWithIdChange: (oldId, newState) => {
    projectLogger.info("StateSlice", "updateStateWithIdChange", {
      oldId,
      newId: newState.id,
    });

    const { transitions } = get();

    // Use coordinator to prepare the update
    const result = StateUpdateCoordinator.prepareStateUpdate(
      get().states.find((s) => s.id === oldId)!,
      newState,
      get().states,
      transitions
    );

    set((state) => {
      // Update state with new ID
      const index = state.states.findIndex((s) => s.id === oldId);
      if (index !== -1) {
        state.states[index] = newState;
      }
    });

    // Update transition references if ID changed
    if (result.idChanged && result.affectedTransitions.length > 0) {
      get().updateStateReferencesInTransitions(oldId, newState.id);
    }

    get().triggerSave();
  },

  deleteState: (stateId) => {
    projectLogger.info("StateSlice", "deleteState", { stateId });
    set((state) => {
      const index = state.states.findIndex((s) => s.id === stateId);
      if (index !== -1) {
        state.states.splice(index, 1);
      }
    });

    // Clean up transitions referencing this state (handled by cross-entity middleware)
    get().removeStateFromTransitions(stateId);
    get().triggerSave();
  },

  batchUpdateStateMonitors: (stateIds, monitors) => {
    projectLogger.info("StateSlice", "batchUpdateStateMonitors", {
      stateIds,
      monitors,
    });
    set((state) => {
      stateIds.forEach((stateId) => {
        const stateObj = state.states.find((s) => s.id === stateId);
        if (stateObj) {
          // Update monitors on all state images
          stateObj.stateImages.forEach((img) => {
            img.monitors = monitors;
          });
        }
      });
    });
    get().triggerSave();
  },

  // Action history updates
  updateStateImageActionHistory: (stateId, imageId, actionHistory) => {
    projectLogger.debug("StateSlice", "updateStateImageActionHistory", {
      stateId,
      imageId,
    });
    set((state) => {
      const stateObj = state.states.find((s) => s.id === stateId);
      if (stateObj) {
        const img = stateObj.stateImages.find((i) => i.id === imageId);
        if (img) {
          img.actionHistory = actionHistory;
        }
      }
    });
  },

  updateStateLocationActionHistory: (stateId, locationId, actionHistory) => {
    projectLogger.debug("StateSlice", "updateStateLocationActionHistory", {
      stateId,
      locationId,
    });
    set((state) => {
      const stateObj = state.states.find((s) => s.id === stateId);
      if (stateObj) {
        const loc = stateObj.locations.find((l) => l.id === locationId);
        if (loc) {
          loc.actionHistory = actionHistory;
        }
      }
    });
  },

  updateStateRegionActionHistory: (stateId, regionId, actionHistory) => {
    projectLogger.debug("StateSlice", "updateStateRegionActionHistory", {
      stateId,
      regionId,
    });
    set((state) => {
      const stateObj = state.states.find((s) => s.id === stateId);
      if (stateObj) {
        const reg = stateObj.regions.find((r) => r.id === regionId);
        if (reg) {
          reg.actionHistory = actionHistory;
        }
      }
    });
  },

  // RAG setup
  applyRAGSetupResults: (results) => {
    projectLogger.info("StateSlice", "applyRAGSetupResults", {
      projectId: results.projectId,
      elementsProcessed: results.elementsProcessed,
    });

    set((state) => {
      results.embeddings.forEach(
        (embedding: {
          stateImageId: string;
          imageEmbedding?: number[];
          textEmbedding?: number[];
          ocrText?: string;
          ocrConfidence?: number;
        }) => {
          // Find state containing this stateImage
          for (const s of state.states) {
            const stateImage = s.stateImages.find(
              (img) => img.id === embedding.stateImageId
            );
            if (stateImage) {
              if (embedding.imageEmbedding) {
                stateImage.imageEmbedding = embedding.imageEmbedding;
              }
              if (embedding.textEmbedding) {
                stateImage.textEmbedding = embedding.textEmbedding;
              }
              if (embedding.ocrText !== undefined) {
                stateImage.ocrText = embedding.ocrText;
              }
              if (embedding.ocrConfidence !== undefined) {
                stateImage.ocrConfidence = embedding.ocrConfidence;
              }
              break;
            }
          }
        }
      );
    });

    get().triggerSave();
  },
});
