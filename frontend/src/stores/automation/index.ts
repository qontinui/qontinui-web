/**
 * Automation Store
 *
 * Zustand store for automation data management.
 * Combines domain slices with persistence via subscription.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
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
  createContextSlice,
} from "./slices";
import { createCrossEntitySlice } from "./middleware";
import { hydrateFromIndexedDB, clearIndexedDB } from "./middleware/persistence";
import {
  workflowRepository,
  stateRepository,
  transitionRepository,
  imageRepository,
} from "@/lib/repositories";
import { screenshotDB } from "@/lib/screenshot-db";
import { projectLogger } from "@/lib/project-logger";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { State, Transition, ImageAsset, Pattern, Category } from "./types";

// Legacy pattern type for migration (patterns with embedded image data)
interface LegacyPattern {
  imageId?: string;
  image?: string;
  mask?: string;
  [key: string]: unknown;
}

// Legacy action config type for migration
interface LegacyActionConfig {
  processId?: string;
  workflowId?: string;
  processRepetition?: unknown;
  repetition?: unknown;
  [key: string]: unknown;
}

// Debounce timers for persistence
const debounceTimers: Record<string, NodeJS.Timeout> = {};
const DEBOUNCE_MS = 500;

/**
 * Migrate workflows from old format to new format
 * - RUN_PROCESS → RUN_WORKFLOW
 * - processId → workflowId
 */
function migrateWorkflows(workflows: Workflow[]): Workflow[] {
  return workflows.map((workflow) => {
    const migratedActions = workflow.actions.map((action) => {
      // Migrate RUN_PROCESS to RUN_WORKFLOW (legacy migration)
      if ((action.type as string) === "RUN_PROCESS") {
        const config = { ...action.config } as LegacyActionConfig;

        // Migrate processId to workflowId
        if (config.processId) {
          config.workflowId = config.processId;
          delete config.processId;
        }

        // Migrate processRepetition to repetition
        if (config.processRepetition) {
          config.repetition = config.processRepetition;
          delete config.processRepetition;
        }

        return {
          ...action,
          type: "RUN_WORKFLOW" as const,
          config,
        };
      }

      return action;
    });

    return {
      ...workflow,
      actions: migratedActions as Workflow["actions"],
    };
  });
}

/**
 * Migrate transitions from old format to new format
 * - Ensure workflows array exists
 */
function migrateTransitions(transitions: Transition[]): Transition[] {
  return transitions.map((transition) => {
    // Ensure workflows is always an array
    if (!transition.workflows) {
      return {
        ...transition,
        workflows: [],
      };
    }

    return transition;
  });
}

/**
 * Migrate patterns with embedded image data to use imageId references
 * This handles legacy patterns that have image/mask data embedded directly
 * instead of referencing the image library
 */
function migratePatternImages(
  states: State[],
  images: ImageAsset[]
): { states: State[]; newImages: ImageAsset[] } {
  const newImages: ImageAsset[] = [];
  let migrationCount = 0;

  const migratedStates = states.map((state) => {
    if (!state.stateImages || state.stateImages.length === 0) {
      return state;
    }

    const migratedStateImages = state.stateImages.map((stateImage) => {
      if (!stateImage.patterns || stateImage.patterns.length === 0) {
        return stateImage;
      }

      const migratedPatterns = stateImage.patterns.map((pattern) => {
        const legacyPattern = pattern as unknown as LegacyPattern;

        // Check if pattern has embedded image data but no imageId
        // OR if pattern.imageId accidentally contains base64 data (fix for corrupted data)
        const imageIdIsData =
          pattern.imageId && pattern.imageId.startsWith("data:image");
        const hasEmbeddedImage =
          !pattern.imageId && "image" in legacyPattern && legacyPattern.image;

        if (hasEmbeddedImage || imageIdIsData) {
          const imageData: string = imageIdIsData
            ? pattern.imageId!
            : (legacyPattern.image as string);

          // Try to find matching image in library
          let matchingImage = images.find((img) => img.url === imageData);

          // If not found, also check newImages we've created in this migration
          if (!matchingImage) {
            matchingImage = newImages.find((img) => img.url === imageData);
          }

          // If still not found, create new image asset
          if (!matchingImage) {
            const newImageId = `migrated-image-${Date.now()}-${Math.random()
              .toString(36)
              .substr(2, 9)}`;
            const newImage: ImageAsset = {
              id: newImageId,
              name: `Migrated Pattern Image ${newImages.length + 1}`,
              url: imageData,
              projectName: state.projectName || "Unknown",
              size: 0, // Unknown size for migrated images
              createdAt: new Date(),
              usageCount: 0,
              source: "migration" as ImageAsset["source"],
            };
            newImages.push(newImage);
            matchingImage = newImage;
            migrationCount++;
          }

          // Return pattern with imageId reference (remove embedded data)
          const { image: _image, mask: _mask, ...cleanPattern } = legacyPattern;
          return { ...cleanPattern, imageId: matchingImage.id } as Pattern;
        }

        return pattern;
      });

      return {
        ...stateImage,
        patterns: migratedPatterns,
      };
    });

    return {
      ...state,
      stateImages: migratedStateImages,
    };
  });

  if (migrationCount > 0) {
    projectLogger.info("Migration", "Migrated embedded pattern images", {
      count: migrationCount,
    });
  }

  return { states: migratedStates, newImages };
}

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

        // Context slice
        ...createContextSlice(set, get, api),

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
            contexts: state.contexts,
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
            // Apply migrations to workflows
            let workflows = config.workflows as Workflow[] | undefined;
            if (workflows && workflows.length > 0) {
              workflows = migrateWorkflows(workflows);
            }

            // Apply migrations to transitions
            let transitions = config.transitions as Transition[] | undefined;
            if (transitions && transitions.length > 0) {
              transitions = migrateTransitions(transitions);
            }

            // Apply migrations to pattern images
            let states = config.states as State[] | undefined;
            let images = config.images as ImageAsset[] | undefined;
            if (states && states.length > 0 && images) {
              const migrationResult = migratePatternImages(states, images);
              states = migrationResult.states;
              // Merge new images from migration
              if (migrationResult.newImages.length > 0) {
                images = [...images, ...migrationResult.newImages];
              }
            }

            // Convert categories from legacy string[] format to Category[] if needed
            let categories: Category[] | undefined;
            if (config.categories && Array.isArray(config.categories)) {
              if (
                config.categories.length > 0 &&
                typeof config.categories[0] === "string"
              ) {
                // Legacy format: string[] - convert to Category[] with only "Main" enabled
                categories = (config.categories as string[]).map((name) => ({
                  name,
                  automationEnabled: name.toLowerCase() === "main",
                }));
                projectLogger.info(
                  "AutomationStore",
                  "Migrated legacy categories to new format",
                  {
                    count: categories.length,
                  }
                );
              } else {
                // New format: Category[]
                categories = config.categories as Category[];
              }
            }

            set((state) => {
              if (config.name) state.projectName = config.name as string;
              if (workflows) state.workflows = workflows;
              if (states) state.states = states;
              if (transitions) state.transitions = transitions;
              if (images) state.images = images;
              if (config.screenshots)
                state.screenshots =
                  config.screenshots as AutomationStore["screenshots"];
              if (config.schedules)
                state.schedules =
                  config.schedules as AutomationStore["schedules"];
              if (config.settings)
                state.settings = config.settings as AutomationStore["settings"];
              if (categories) state.categories = categories;
              if (config.contexts)
                state.contexts = config.contexts as AutomationStore["contexts"];
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
            state.contexts = [];
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
      }))
  )
);

// Persistence helpers using Repository pattern
async function persistWorkflows(
  workflows: Workflow[],
  projectName: string
): Promise<void> {
  // Delete existing and replace with new (full replacement strategy)
  await workflowRepository.deleteByProject(projectName);
  await Promise.all(
    workflows.map((w) => workflowRepository.add({ ...w, projectName }))
  );
}

async function persistStates(
  states: AutomationStore["states"],
  projectName: string
): Promise<void> {
  await stateRepository.deleteByProject(projectName);
  await Promise.all(
    states.map((s) => stateRepository.add({ ...s, projectName }))
  );
}

async function persistTransitions(
  transitions: AutomationStore["transitions"],
  projectName: string
): Promise<void> {
  await transitionRepository.deleteByProject(projectName);
  await Promise.all(
    transitions.map((t) => transitionRepository.add({ ...t, projectName }))
  );
}

async function persistImages(
  images: AutomationStore["images"],
  projectName: string
): Promise<void> {
  await imageRepository.deleteByProject(projectName);
  await Promise.all(
    images.map((i) => imageRepository.add({ ...i, projectName }))
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
      if (
        state.projectName === "Untitled Project" &&
        states.some(
          (s) => s.projectName && s.projectName !== "Untitled Project"
        )
      ) {
        projectLogger.debug(
          "Persistence",
          "Skipping states persist - projectName mismatch",
          {
            storeProjectName: state.projectName,
            stateProjectNames: [...new Set(states.map((s) => s.projectName))],
          }
        );
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
      if (
        state.projectName === "Untitled Project" &&
        images.some(
          (i) => i.projectName && i.projectName !== "Untitled Project"
        )
      ) {
        projectLogger.debug(
          "Persistence",
          "Skipping images persist - projectName mismatch",
          {
            storeProjectName: state.projectName,
            imageProjectNames: [...new Set(images.map((i) => i.projectName))],
          }
        );
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
    state.categories = [
      { name: "Main", automationEnabled: true },
      { name: "Incoming Transitions", automationEnabled: false },
      { name: "Outgoing Transitions", automationEnabled: false },
    ];
    state.contexts = [];
  });
}

// Re-export types
export * from "./types";

// Re-export provider
export { AutomationProvider } from "./AutomationProvider";
