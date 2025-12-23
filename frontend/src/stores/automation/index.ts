/**
 * Automation Store
 *
 * Zustand store for automation data management.
 * Combines domain slices with persistence via subscription.
 */

import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { AutomationStore } from "./types";
import {
  createProjectSlice,
  createWorkflowSlice,
  createStateSlice,
  createTransitionSlice,
  createImageSlice,
  createScreenshotSlice,
  createScheduleSlice,
  createSettingsSlice,
} from "./slices";
import { createCrossEntitySlice } from "./middleware";
import { hydrateFromIndexedDB, clearIndexedDB } from "./middleware/persistence";
import { projectDB } from "@/lib/project-db";
import { screenshotDB } from "@/lib/screenshot-db";
import { projectLogger } from "@/lib/project-logger";
import type { Workflow } from "@/lib/action-schema/action-types";

// Debounce timers for persistence
const debounceTimers: Record<string, NodeJS.Timeout> = {};
const DEBOUNCE_MS = 500;

/**
 * Schedule a debounced persist operation
 */
function schedulePersist<T>(
  key: string,
  data: T[],
  projectName: string,
  persistFn: (data: T[], projectName: string) => Promise<void>
): void {
  if (debounceTimers[key]) {
    clearTimeout(debounceTimers[key]);
  }

  debounceTimers[key] = setTimeout(async () => {
    if (projectName) {
      try {
        await persistFn(data, projectName);
        projectLogger.debug("Persistence", `Persisted ${key}`, {
          count: data.length,
        });
      } catch (error) {
        projectLogger.error("Persistence", `Failed to persist ${key}`, {
          error,
        });
      }
    }
  }, DEBOUNCE_MS);
}

/**
 * Combined automation store with all slices
 */
export const useAutomationStore = create<AutomationStore>()(
  subscribeWithSelector(
    devtools(
      immer((set, get, api) => ({
        // Project slice
        ...createProjectSlice(set, get, api),

        // Workflow slice
        ...createWorkflowSlice(set, get, api),

        // State slice
        ...createStateSlice(set, get, api),

        // Transition slice
        ...createTransitionSlice(set, get, api),

        // Image slice
        ...createImageSlice(set, get, api),

        // Screenshot slice
        ...createScreenshotSlice(set, get, api),

        // Schedule slice
        ...createScheduleSlice(set, get, api),

        // Settings slice
        ...createSettingsSlice(set, get, api),

        // Cross-entity operations
        ...createCrossEntitySlice(set, get, api),

        // Configuration operations
        getConfiguration: () => {
          const state = get();
          return {
            name: state.projectName,
            version: "2.0.0",
            workflows: state.workflows,
            states: state.states,
            transitions: state.transitions,
            images: state.images,
            screenshots: state.screenshots,
            schedules: state.schedules,
            settings: state.settings,
            categories: state.categories,
          };
        },

        loadConfiguration: async (config) => {
          projectLogger.info("AutomationStore", "loadConfiguration", {
            name: config.name,
          });

          set((state) => {
            state.isLoadingFromBackend = true;
          });

          try {
            set((state) => {
              if (config.name) state.projectName = config.name as string;
              if (config.workflows)
                state.workflows =
                  config.workflows as AutomationStore["workflows"];
              if (config.states)
                state.states = config.states as AutomationStore["states"];
              if (config.transitions)
                state.transitions =
                  config.transitions as AutomationStore["transitions"];
              if (config.images)
                state.images = config.images as AutomationStore["images"];
              if (config.screenshots)
                state.screenshots =
                  config.screenshots as AutomationStore["screenshots"];
              if (config.schedules)
                state.schedules =
                  config.schedules as AutomationStore["schedules"];
              if (config.settings)
                state.settings = config.settings as AutomationStore["settings"];
              if (config.categories)
                state.categories = config.categories as string[];
            });

            projectLogger.info("AutomationStore", "Configuration loaded");
          } finally {
            set((state) => {
              state.isLoadingFromBackend = false;
            });
          }
        },

        clearAllData: () => {
          projectLogger.info("AutomationStore", "clearAllData");
          const projectName = get().projectName;

          set((state) => {
            state.workflows = [];
            state.states = [];
            state.transitions = [];
            state.images = [];
            state.screenshots = [];
            state.schedules = [];
            state.executionRecords = [];
          });

          // Clear IndexedDB
          if (projectName) {
            clearIndexedDB(projectName).catch((error) => {
              projectLogger.error(
                "AutomationStore",
                "Failed to clear IndexedDB",
                {
                  error,
                }
              );
            });
          }
        },
      })),
      { name: "automation-store" }
    )
  )
);

// Persistence helpers
async function persistWorkflows(
  workflows: Workflow[],
  projectName: string
): Promise<void> {
  const existing = await projectDB.getWorkflowsByProject(projectName);
  await Promise.all(existing.map((w) => projectDB.deleteWorkflow(w.id)));
  await Promise.all(
    workflows.map((w) =>
      projectDB.addWorkflow({ ...w, projectName } as Workflow & {
        projectName: string;
      })
    )
  );
}

async function persistStates(
  states: AutomationStore["states"],
  projectName: string
): Promise<void> {
  const existing = await projectDB.getStatesByProject(projectName);
  await Promise.all(existing.map((s) => projectDB.deleteState(s.id)));
  await Promise.all(
    states.map((s) => projectDB.addState({ ...s, projectName }))
  );
}

async function persistTransitions(
  transitions: AutomationStore["transitions"],
  projectName: string
): Promise<void> {
  const existing = await projectDB.getTransitionsByProject(projectName);
  await Promise.all(existing.map((t) => projectDB.deleteTransition(t.id)));
  await Promise.all(
    transitions.map((t) => projectDB.addTransition({ ...t, projectName }))
  );
}

async function persistImages(
  images: AutomationStore["images"],
  projectName: string
): Promise<void> {
  const existing = await projectDB.getImagesByProject(projectName);
  await Promise.all(existing.map((i) => projectDB.deleteImage(i.id)));
  await Promise.all(
    images.map((i) => projectDB.addImage({ ...i, projectName }))
  );
}

async function persistScreenshots(
  screenshots: AutomationStore["screenshots"],
  projectName: string
): Promise<void> {
  const existing = await screenshotDB.getByProject(projectName);
  await Promise.all(existing.map((s) => screenshotDB.delete(s.id)));
  await Promise.all(
    screenshots.map((s) =>
      screenshotDB.add({
        ...s,
        projectName,
        uploadedAt: s.uploadedAt || new Date(),
      })
    )
  );
}

// Set up subscriptions for persistence (only runs in browser)
if (typeof window !== "undefined") {
  // Subscribe to workflow changes
  useAutomationStore.subscribe(
    (state) => state.workflows,
    (workflows, prevWorkflows) => {
      if (workflows === prevWorkflows) return;
      const state = useAutomationStore.getState();
      if (state.isLoadingFromBackend || !state.projectName) return;
      schedulePersist(
        "workflows",
        workflows,
        state.projectName,
        persistWorkflows
      );
    }
  );

  // Subscribe to state changes
  useAutomationStore.subscribe(
    (state) => state.states,
    (states, prevStates) => {
      if (states === prevStates) return;
      const state = useAutomationStore.getState();
      if (state.isLoadingFromBackend || !state.projectName) return;
      // Skip persistence if store's projectName is still the default "Untitled Project"
      // This prevents data from being persisted with the wrong projectName
      if (state.projectName === "Untitled Project" && states.some(s => s.projectName && s.projectName !== "Untitled Project")) {
        projectLogger.debug("Persistence", "Skipping states persist - projectName mismatch", {
          storeProjectName: state.projectName,
          stateProjectNames: [...new Set(states.map(s => s.projectName))],
        });
        return;
      }
      schedulePersist("states", states, state.projectName, persistStates);
    }
  );

  // Subscribe to transition changes
  useAutomationStore.subscribe(
    (state) => state.transitions,
    (transitions, prevTransitions) => {
      if (transitions === prevTransitions) return;
      const state = useAutomationStore.getState();
      if (state.isLoadingFromBackend || !state.projectName) return;
      schedulePersist(
        "transitions",
        transitions,
        state.projectName,
        persistTransitions
      );
    }
  );

  // Subscribe to image changes
  useAutomationStore.subscribe(
    (state) => state.images,
    (images, prevImages) => {
      if (images === prevImages) return;
      const state = useAutomationStore.getState();
      if (state.isLoadingFromBackend || !state.projectName) return;
      // Skip persistence if store's projectName is still the default "Untitled Project"
      // This prevents data from being persisted with the wrong projectName
      if (state.projectName === "Untitled Project" && images.some(i => i.projectName && i.projectName !== "Untitled Project")) {
        projectLogger.debug("Persistence", "Skipping images persist - projectName mismatch", {
          storeProjectName: state.projectName,
          imageProjectNames: [...new Set(images.map(i => i.projectName))],
        });
        return;
      }
      schedulePersist("images", images, state.projectName, persistImages);
    }
  );

  // Subscribe to screenshot changes
  useAutomationStore.subscribe(
    (state) => state.screenshots,
    (screenshots, prevScreenshots) => {
      if (screenshots === prevScreenshots) return;
      const state = useAutomationStore.getState();
      if (state.isLoadingFromBackend || !state.projectName) return;
      schedulePersist(
        "screenshots",
        screenshots,
        state.projectName,
        persistScreenshots
      );
    }
  );
}

/**
 * Hydrate the store from IndexedDB for a specific project
 */
export async function hydrateStore(projectName: string): Promise<void> {
  projectLogger.info("AutomationStore", "hydrateStore", { projectName });

  useAutomationStore.getState().setIsLoadingFromBackend(true);

  try {
    const data = await hydrateFromIndexedDB(projectName);

    useAutomationStore.setState((state) => {
      state.projectName = projectName;
      if (data.workflows) state.workflows = data.workflows;
      if (data.states) state.states = data.states;
      if (data.transitions) state.transitions = data.transitions;
      if (data.images) state.images = data.images;
      if (data.screenshots) state.screenshots = data.screenshots;
    });

    projectLogger.info("AutomationStore", "Store hydrated");
  } finally {
    useAutomationStore.getState().setIsLoadingFromBackend(false);
  }
}

/**
 * Reset the store to initial state
 */
export function resetStore(): void {
  projectLogger.info("AutomationStore", "resetStore");
  useAutomationStore.setState((state) => {
    state.projectName = "Untitled Project";
    state.projectId = null;
    state.lastSaved = null;
    state.isLoadingFromBackend = false;
    state.workflows = [];
    state.states = [];
    state.transitions = [];
    state.images = [];
    state.screenshots = [];
    state.schedules = [];
    state.executionRecords = [];
    state.categories = ["Main", "Incoming Transitions", "Outgoing Transitions"];
  });
}

// Re-export types
export * from "./types";

// Re-export provider
export { AutomationProvider } from "./AutomationProvider";

// Re-export utility classes from automation-context (for backward compatibility)
export { StateUpdateCoordinator } from "@/contexts/automation-context/state-update-coordinator";
export { TransitionReferenceUpdater } from "@/contexts/automation-context/transition-reference-updater";
