"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { StateManager } from "./state-manager";
import { TransitionManager } from "./transition-manager";
import { ImageManager } from "./image-manager";
import { ActionHistoryManager } from "./action-history-manager";
import { ScreenshotManager } from "./screenshot-manager";
import { screenshotDB, normalizeUrl } from "@/lib/screenshot-db";
import { projectDB } from "@/lib/project-db";
import { projectLogger } from "@/lib/project-logger";
import { useAutomationStore } from "@/stores/automation";
import { apiClient } from "@/lib/api-client";
import type {
  AutomationContextType,
  State,
  Transition,
  IncomingTransition,
  Pattern,
  ImageAsset,
  ImageUsage,
  ActionHistory,
  Screenshot,
  Schedule,
  ExecutionRecord,
  SchedulerStatistics,
} from "./types";
import type { ProjectSettings } from "@/types/project-settings";
import type { Workflow } from "@/lib/action-schema/action-types";

// Export types for external use
export type {
  State,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  SearchRegion,
  Position,
  PositionName,
  Pattern,
  Transition,
  TransitionType,
  BaseTransition,
  OutgoingTransition,
  IncomingTransition,
  ImageAsset,
  ImageUsage,
  ActionHistory,
  Screenshot,
  Schedule,
  ExecutionRecord,
  TriggerType,
  CheckMode,
  ScheduleType,
  StateCheckResult,
  SchedulerStatistics,
} from "./types";

// Export utility classes
export { StateIdManager } from "./state-id-manager";
export { TransitionReferenceUpdater } from "./transition-reference-updater";
export { StateUpdateCoordinator } from "./state-update-coordinator";

// ============================================================================
// Data Migration Functions
// ============================================================================

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
        const config = { ...action.config };

        // Migrate processId to workflowId
        if ((config as unknown).processId) {
          (config as unknown).workflowId = (config as unknown).processId;
          delete (config as unknown).processId;
        }

        // Migrate processRepetition to repetition
        if ((config as unknown).processRepetition) {
          (config as unknown).repetition = (
            config as unknown
          ).processRepetition;
          delete (config as unknown).processRepetition;
        }

        return {
          ...action,
          type: "RUN_WORKFLOW" as unknown,
          config,
        };
      }

      return action;
    });

    return {
      ...workflow,
      actions: migratedActions,
    };
  });
}

/**
 * Migrate transitions from old format to new format
 * - Populate empty workflows arrays from old process field
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
        const patternAny = pattern as unknown;

        // Check if pattern has embedded image data but no imageId
        // OR if pattern.imageId accidentally contains base64 data (fix for corrupted data)
        const imageIdIsData =
          pattern.imageId && pattern.imageId.startsWith("data:image");
        const hasEmbeddedImage = !pattern.imageId && patternAny.image;

        if (hasEmbeddedImage || imageIdIsData) {
          const imageData = imageIdIsData ? pattern.imageId! : patternAny.image;

          // Try to find matching image in library
          let matchingImage = images.find((img) => img.url === imageData);

          // If not found, also check newImages we've created in this migration
          if (!matchingImage) {
            matchingImage = newImages.find((img) => img.url === imageData);
          }

          // If still not found, create a new image asset
          if (!matchingImage) {
            const imageId = `image-migrated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            matchingImage = {
              id: imageId,
              name: pattern.name || stateImage.name || "Migrated Image",
              url: imageData,
              mask: patternAny.mask,
              size: Math.ceil(((imageData.split(",")[1] || "").length * 3) / 4),
              createdAt: new Date(),
              usageCount: 1,
              usage: [],
              source: "image_extraction" as const,
            };
            newImages.push(matchingImage);
          }

          migrationCount++;
          console.log(
            `[Migration] Pattern ${pattern.id} migrated to use imageId: ${matchingImage.id}`
          );

          // Return pattern with imageId, removing embedded data
          // If imageId was the data, it gets overwritten here
          const { image, mask, ...rest } = patternAny;
          return {
            ...rest,
            imageId: matchingImage.id,
          };
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
    console.log(
      `[Migration] Migrated ${migrationCount} patterns to use imageId references`
    );
  }

  return { states: migratedStates, newImages };
}

const AutomationContext = createContext<AutomationContextType | undefined>(
  undefined
);

export const useAutomation = () => {
  const context = useContext(AutomationContext);
  if (!context) {
    throw new Error("useAutomation must be used within an AutomationProvider");
  }
  return context;
};

interface AutomationProviderProps {
  children: ReactNode;
}

export function AutomationProvider({ children }: AutomationProviderProps) {
  // Track if we&apos;re in the middle of renaming to prevent premature reload
  const isRenamingRef = useRef(false);

  // Track if we&apos;re loading from backend to prevent IndexedDB from overwriting
  const [isLoadingFromBackend, setIsLoadingFromBackendState] = useState(false);
  const isLoadingFromBackendRef = useRef(false);

  // Wrapper that updates both ref (synchronously) and state
  // This prevents race conditions where the ref is checked before state updates
  const setIsLoadingFromBackend = useCallback((value: boolean) => {
    isLoadingFromBackendRef.current = value;
    setIsLoadingFromBackendState(value);
    projectLogger.contextProvider("isLoadingFromBackend set", { value });
  }, []);

  // Keep ref in sync with state (backup for any direct state updates)
  useEffect(() => {
    isLoadingFromBackendRef.current = isLoadingFromBackend;
  }, [isLoadingFromBackend]);

  // Clean up old settings and categories on mount
  useEffect(() => {
    const oldSettings = localStorage.getItem("qontinui-settings");
    if (oldSettings) {
      console.log("Removing old settings, applying new defaults");
      localStorage.removeItem("qontinui-settings");
    }

    // Remove old global categories key - categories are now per-project
    const oldCategories = localStorage.getItem("qontinui-categories");
    if (oldCategories) {
      console.log(
        "Removing old global categories - categories are now per-project"
      );
      localStorage.removeItem("qontinui-categories");
    }
  }, []);

  // State for project metadata - using localStorage for persistence
  const [projectName, setProjectName] = useLocalStorage<string>(
    "qontinui-project-name",
    "Untitled Project"
  );
  const [lastSaved, setLastSaved] = useLocalStorage<string | null>(
    "qontinui-lastSaved",
    null
  );
  // Project ID is persisted to localStorage so it survives page navigations
  const [projectId, setProjectId] = useLocalStorage<string | null>(
    "qontinui-selected-project-id",
    null
  );

  // Categories are now stored per-project in the database, not in global localStorage
  const [categories, setCategories] = useState<string[]>([]);

  // Settings are now per-project using the project name in the key
  const settingsKey = `qontinui-settings-v2-${projectName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`;

  // Force correct defaults - hardcoded to ensure they&apos;re applied
  const CORRECT_DEFAULTS: ProjectSettings = {
    mouse: {
      click_hold_duration: 100,
      click_release_delay: 50,
      click_safety_release: true,
      double_click_interval: 300,
      drag_start_delay: 100,
      drag_end_delay: 100,
      drag_default_duration: 500,
      move_default_duration: 500,
      safety_release_delay: 50,
    },
    keyboard: {
      key_hold_duration: 50,
      key_release_delay: 50,
      typing_interval: 50,
      hotkey_hold_duration: 100,
      hotkey_press_interval: 50,
    },
    find: {
      default_timeout: 30000,
      default_retry_count: 0,
      search_interval: 500,
    },
    wait: {
      pause_before_action: 0,
      pause_after_action: 0,
    },
    execution: {
      default_timeout: 10000,
      default_retry_count: 0,
      action_delay: 100,
      failure_strategy: "continue",
    },
    recognition: {
      default_threshold: 0.7,
      multi_scale_search: false,
      color_space: "rgb",
      edge_detection: false,
      ocr_enabled: false,
    },
  };

  const [settings, setSettings] = useLocalStorage<ProjectSettings>(
    settingsKey,
    CORRECT_DEFAULTS
  );

  // All project data now uses IndexedDB for persistence and project isolation
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [executionRecords, setExecutionRecords] = useState<ExecutionRecord[]>(
    []
  );

  // Load all data from IndexedDB on mount and when project changes
  useEffect(() => {
    // Track if this effect's load should be aborted (stale closure prevention)
    let isAborted = false;
    const currentProjectName = projectName;

    const loadProjectData = async () => {
      projectLogger.contextProvider("loadProjectData triggered", {
        projectName: currentProjectName,
        isRenaming: isRenamingRef.current,
        isLoadingFromBackend: isLoadingFromBackendRef.current,
      });

      // Skip loading if we&apos;re loading from backend (prevents race condition)
      if (isLoadingFromBackendRef.current) {
        projectLogger.contextProvider(
          "SKIPPING IndexedDB load - loading from backend",
          {
            projectName: currentProjectName,
          }
        );
        return;
      }

      // Skip loading if we&apos;re in the middle of a rename operation
      if (isRenamingRef.current) {
        projectLogger.contextProvider(
          "SKIPPING IndexedDB load - rename in progress",
          {
            projectName: currentProjectName,
          }
        );
        isRenamingRef.current = false; // Reset the flag
        return;
      }

      projectLogger.contextProvider("Starting IndexedDB load for project", {
        projectName: currentProjectName,
      });

      // One-time migration: rename "bdo-mask" to "bdo" (only if not already migrated)
      const migrationKey = "qontinui-migration-bdo-mask-to-bdo-done";
      if (currentProjectName === "bdo" && !localStorage.getItem(migrationKey)) {
        try {
          const oldData = await projectDB.getStatesByProject("bdo-mask");
          if (oldData.length > 0) {
            console.log('Migrating data from "bdo-mask" to "bdo"...');
            await projectDB.renameProject("bdo-mask", "bdo");
            localStorage.setItem(migrationKey, "true");
            console.log("Migration complete!");
          }
        } catch (error) {
          console.error("Migration failed:", error);
        }
      }

      // Check if this load was aborted (project changed before we finished migrations)
      if (isAborted) {
        projectLogger.contextProvider("Load aborted after migrations", {
          projectName: currentProjectName,
        });
        return;
      }

      // Migrate data from localStorage to IndexedDB if needed
      try {
        // Migrate states
        const localStorageStates =
          window.localStorage.getItem("qontinui-states");
        if (localStorageStates) {
          const parsed = JSON.parse(localStorageStates) as State[];
          if (parsed.length > 0) {
            console.log(
              `Migrating ${parsed.length} states from localStorage to IndexedDB...`
            );
            for (const state of parsed) {
              try {
                await projectDB.updateState({
                  ...state,
                  projectName: currentProjectName,
                });
              } catch (error) {
                console.error(`Failed to migrate state ${state.id}:`, error);
              }
            }
            window.localStorage.removeItem("qontinui-states");
          }
        }

        // Migrate transitions
        const localStorageTransitions = window.localStorage.getItem(
          "qontinui-transitions"
        );
        if (localStorageTransitions) {
          const parsed = JSON.parse(localStorageTransitions) as Transition[];
          if (parsed.length > 0) {
            console.log(
              `Migrating ${parsed.length} transitions from localStorage to IndexedDB...`
            );
            for (const transition of parsed) {
              try {
                await projectDB.updateTransition({
                  ...transition,
                  projectName: currentProjectName,
                });
              } catch (error) {
                console.error(
                  `Failed to migrate transition ${transition.id}:`,
                  error
                );
              }
            }
            window.localStorage.removeItem("qontinui-transitions");
          }
        }

        // Migrate images
        const localStorageImages =
          window.localStorage.getItem("qontinui-images");
        if (localStorageImages) {
          const parsed = JSON.parse(localStorageImages) as ImageAsset[];
          if (parsed.length > 0) {
            console.log(
              `Migrating ${parsed.length} images from localStorage to IndexedDB...`
            );
            for (const image of parsed) {
              try {
                await projectDB.updateImage({
                  ...image,
                  projectName: currentProjectName,
                });
              } catch (error) {
                console.error(`Failed to migrate image ${image.id}:`, error);
              }
            }
            window.localStorage.removeItem("qontinui-images");
          }
        }

        // Migrate screenshots
        const localStorageScreenshots = window.localStorage.getItem(
          "qontinui-screenshots"
        );
        if (localStorageScreenshots) {
          const parsed = JSON.parse(localStorageScreenshots) as Screenshot[];
          if (parsed.length > 0) {
            console.log(
              `Migrating ${parsed.length} screenshots from localStorage to IndexedDB...`
            );
            for (const screenshot of parsed) {
              try {
                await screenshotDB.update({
                  ...screenshot,
                  projectName: currentProjectName,
                }); // Use update instead of add to handle duplicates
              } catch (error) {
                console.error(
                  `Failed to migrate screenshot ${screenshot.id}:`,
                  error
                );
              }
            }
            window.localStorage.removeItem("qontinui-screenshots");
          }
        }

        console.log("Migration complete");
      } catch (error) {
        console.error("Error during data migration:", error);
      }

      // Check if this load was aborted (project changed during localStorage migration)
      if (isAborted) {
        projectLogger.contextProvider(
          "Load aborted after localStorage migration",
          {
            projectName: currentProjectName,
          }
        );
        return;
      }

      // Load all data from IndexedDB for current project
      const [
        loadedWorkflows,
        loadedStates,
        loadedTransitions,
        loadedImages,
        loadedScreenshots,
      ] = await Promise.all([
        projectDB.getWorkflowsByProject(currentProjectName),
        projectDB.getStatesByProject(currentProjectName),
        projectDB.getTransitionsByProject(currentProjectName),
        projectDB.getImagesByProject(currentProjectName),
        screenshotDB.getByProject(currentProjectName),
      ]);

      // Migrate old data formats to new schema
      const migratedWorkflows = migrateWorkflows(loadedWorkflows);
      const migratedTransitions = migrateTransitions(loadedTransitions);

      // Save migrated data back to database if changes were made
      let workflowsMigrated = false;
      let transitionsMigrated = false;

      for (let i = 0; i < migratedWorkflows.length; i++) {
        if (
          JSON.stringify(migratedWorkflows[i]) !==
          JSON.stringify(loadedWorkflows[i])
        ) {
          workflowsMigrated = true;
          const workflowWithProject = {
            ...migratedWorkflows[i],
            projectName: currentProjectName,
          } as Workflow & { projectName: string };
          await projectDB.updateWorkflow(workflowWithProject);
        }
      }

      for (let i = 0; i < migratedTransitions.length; i++) {
        if (
          JSON.stringify(migratedTransitions[i]) !==
          JSON.stringify(loadedTransitions[i])
        ) {
          transitionsMigrated = true;
          const transitionWithProject = {
            ...migratedTransitions[i],
            projectName: currentProjectName,
          } as Transition & { projectName: string };
          await projectDB.updateTransition(transitionWithProject);
        }
      }

      if (workflowsMigrated || transitionsMigrated) {
        console.log(
          `Data migration completed - Workflows: ${workflowsMigrated}, Transitions: ${transitionsMigrated}`
        );
      }

      // Migrate patterns with embedded image data to use imageId references
      const { states: migratedStates, newImages: patternMigrationImages } =
        migratePatternImages(loadedStates, loadedImages);

      // If any patterns were migrated, save the updated states and new images
      if (patternMigrationImages.length > 0) {
        // Save new images to database
        for (const newImage of patternMigrationImages) {
          const imageWithProject = {
            ...newImage,
            projectName: currentProjectName,
          } as ImageAsset & { projectName: string };
          await projectDB.addImage(imageWithProject);
        }
      }

      // Check if any states were modified by the migration
      let statesMigrated = false;
      for (let i = 0; i < migratedStates.length; i++) {
        if (
          JSON.stringify(migratedStates[i]) !== JSON.stringify(loadedStates[i])
        ) {
          statesMigrated = true;
          const stateWithProject = {
            ...migratedStates[i],
            projectName: currentProjectName,
          } as State & { projectName: string };
          await projectDB.updateState(stateWithProject);
        }
      }

      if (statesMigrated) {
        console.log(
          `Pattern image migration completed - ${patternMigrationImages.length} new images created`
        );
      }

      // Combine loaded images with any new images from migration
      const allImages = [...loadedImages, ...patternMigrationImages];

      // Final check if this load was aborted before setting state
      // This is the critical check that prevents stale data from overwriting current data
      if (isAborted) {
        projectLogger.contextProvider(
          "Load aborted before setting state - preventing stale data overwrite",
          {
            projectName: currentProjectName,
            workflowCount: loadedWorkflows.length,
            stateCount: loadedStates.length,
          }
        );
        return;
      }

      setWorkflows(migratedWorkflows);
      setStates(migratedStates);
      setTransitions(migratedTransitions);
      setImages(allImages);
      setScreenshots(loadedScreenshots);

      // Also sync to Zustand store for UI components that read from there
      // (StateStructure, etc. use useStates() which reads from Zustand, not Context)
      const zustandStore = useAutomationStore.getState();
      zustandStore.loadConfiguration({
        name: currentProjectName,
        workflows: migratedWorkflows,
        states: migratedStates,
        transitions: migratedTransitions,
        images: allImages,
        screenshots: loadedScreenshots,
      });

      // Extract unique categories from loaded workflows, always including Main and transition categories
      const workflowCategories = loadedWorkflows
        .map((w) => w.category)
        .filter((cat): cat is string => cat != null && cat !== "");

      const uniqueCategories = Array.from(
        new Set([
          "Main",
          "Incoming Transitions",
          "Outgoing Transitions",
          ...workflowCategories,
        ])
      );
      setCategories(uniqueCategories);

      console.log(
        `Loaded project data - Workflows: ${migratedWorkflows.length}, States: ${migratedStates.length}, Transitions: ${migratedTransitions.length}, Images: ${allImages.length}, Screenshots: ${loadedScreenshots.length}, Categories: ${uniqueCategories.length}`
      );
    };

    loadProjectData();

    // Cleanup function - abort the load if projectName changes before it completes
    return () => {
      isAborted = true;
      projectLogger.contextProvider(
        "Project changed - aborting previous load",
        {
          abortedProject: currentProjectName,
        }
      );
    };
  }, [projectName]);

  // Workflow management functions
  const addWorkflow = useCallback(
    async (workflow: Workflow) => {
      const workflowWithProject = { ...workflow, projectName } as Workflow & {
        projectName: string;
      };
      try {
        await projectDB.addWorkflow(workflowWithProject);
      } catch (error: unknown) {
        // If key already exists, update instead
        if ((error as Error).name === "ConstraintError") {
          await projectDB.updateWorkflow(workflowWithProject);
        } else {
          throw error;
        }
      }
      setWorkflows((prev) => [...prev, workflow]);
    },
    [projectName]
  );

  const updateWorkflow = useCallback(
    async (workflow: Workflow) => {
      console.log("[AutomationContext] updateWorkflow called:", {
        id: workflow.id,
        name: workflow.name,
        actionsCount: workflow.actions.length,
        projectName,
      });
      const workflowWithProject = { ...workflow, projectName } as Workflow & {
        projectName: string;
      };
      await projectDB.updateWorkflow(workflowWithProject);
      console.log(
        "[AutomationContext] Database update completed for workflow:",
        workflow.id
      );
      setWorkflows((prev) =>
        prev.map((w) => (w.id === workflow.id ? workflow : w))
      );
      console.log(
        "[AutomationContext] State updated for workflow:",
        workflow.id
      );
    },
    [projectName]
  );

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    await projectDB.deleteWorkflow(workflowId);
    setWorkflows((prev) => prev.filter((w) => w.id !== workflowId));
  }, []);

  // State management functions
  const addState = useCallback(
    async (state: State) => {
      const stateWithProject = { ...state, projectName };
      try {
        await projectDB.addState(stateWithProject);
      } catch (error: unknown) {
        // If key already exists, update instead
        if (error.name === "ConstraintError") {
          await projectDB.updateState(stateWithProject);
        } else {
          throw error;
        }
      }
      setStates((prev) => StateManager.addState(prev, stateWithProject));

      // Also sync to Zustand store so StateStructure and other components see the new state
      const zustandStore = useAutomationStore.getState();
      zustandStore.addState(stateWithProject);

      // Auto-create an incoming transition for this state
      // Every state should have exactly one incoming transition
      const incomingTransition: IncomingTransition = {
        id: `incoming-${state.id}`,
        type: "IncomingTransition",
        toState: state.id,
        workflows: [], // Default: empty workflows (returns true by default)
        timeout: 10000,
        retryCount: 3,
        projectName,
      };

      try {
        await projectDB.addTransition(incomingTransition);
        setTransitions((prev) => [...prev, incomingTransition]);
        // Also sync transition to Zustand store
        zustandStore.addTransition(incomingTransition);
      } catch (error: unknown) {
        // If transition already exists, ignore the error
        if (error.name !== "ConstraintError") {
          console.error("Failed to create incoming transition:", error);
        }
      }
    },
    [projectName]
  );

  const updateState = useCallback(async (state: State) => {
    await projectDB.updateState(state);
    setStates((prev) => StateManager.updateState(prev, state));
    // Also sync to Zustand store
    const zustandStore = useAutomationStore.getState();
    zustandStore.updateState(state);
  }, []);

  const updateStateWithIdChange = useCallback(
    async (oldId: string, newState: State) => {
      await projectDB.updateStateWithIdChange(oldId, newState);
      setStates((prev) =>
        StateManager.updateStateWithIdChange(prev, oldId, newState)
      );
      // Also sync to Zustand store
      const zustandStore = useAutomationStore.getState();
      zustandStore.updateStateWithIdChange(oldId, newState);
    },
    []
  );

  const deleteState = useCallback(async (stateId: string) => {
    await projectDB.deleteState(stateId);
    setStates((prev) => StateManager.deleteState(prev, stateId));
    // Clean up transitions that reference this state
    setTransitions((prev) =>
      TransitionManager.removeStateFromTransitions(prev, stateId)
    );
    // Also sync to Zustand store
    const zustandStore = useAutomationStore.getState();
    zustandStore.deleteState(stateId);
  }, []);

  // Transition management functions
  const addTransition = useCallback(
    async (transition: Transition) => {
      const transitionWithProject = { ...transition, projectName };
      try {
        await projectDB.addTransition(transitionWithProject);
      } catch (error: unknown) {
        // If key already exists, update instead
        if (error.name === "ConstraintError") {
          await projectDB.updateTransition(transitionWithProject);
        } else {
          throw error;
        }
      }
      setTransitions((prev) =>
        TransitionManager.addTransition(prev, transitionWithProject)
      );

      // Also sync to Zustand store so UI components see the new transition
      const zustandStore = useAutomationStore.getState();
      zustandStore.addTransition(transitionWithProject);
    },
    [projectName]
  );

  const updateTransition = useCallback(async (transition: Transition) => {
    await projectDB.updateTransition(transition);
    setTransitions((prev) =>
      TransitionManager.updateTransition(prev, transition)
    );

    // Also sync to Zustand store so UI components see the update
    const zustandStore = useAutomationStore.getState();
    zustandStore.updateTransition(transition);
  }, []);

  const deleteTransition = useCallback(async (transitionId: string) => {
    await projectDB.deleteTransition(transitionId);
    setTransitions((prev) =>
      TransitionManager.deleteTransition(prev, transitionId)
    );

    // Also sync to Zustand store so UI components see the deletion
    const zustandStore = useAutomationStore.getState();
    zustandStore.deleteTransition(transitionId);
  }, []);

  // Image management functions
  const addImage = useCallback(
    async (image: ImageAsset) => {
      const imageWithProject = { ...image, projectName };
      try {
        await projectDB.addImage(imageWithProject);
      } catch (error: unknown) {
        // If key already exists, update instead
        if (error.name === "ConstraintError") {
          await projectDB.updateImage(imageWithProject);
        } else {
          throw error;
        }
      }
      setImages((prev) => ImageManager.addImage(prev, imageWithProject));
      // Also sync to Zustand store so StateNode and other components see the new image
      const zustandStore = useAutomationStore.getState();
      zustandStore.addImage(imageWithProject);
    },
    [projectName]
  );

  const deleteImage = useCallback(async (imageId: string) => {
    await projectDB.deleteImage(imageId);
    setImages((prev) => ImageManager.deleteImage(prev, imageId));
  }, []);

  const updateImageUsage = useCallback(
    async (imageId: string, usage: ImageUsage) => {
      const updatedImages = ImageManager.updateImageUsage(
        images,
        imageId,
        usage
      );
      const updatedImage = updatedImages.find((img) => img.id === imageId);
      if (updatedImage) {
        await projectDB.updateImage(updatedImage);
      }
      setImages(updatedImages);
    },
    [images]
  );

  const removeImageUsage = useCallback(
    async (imageId: string, usageId: string) => {
      const updatedImages = ImageManager.removeImageUsage(
        images,
        imageId,
        usageId
      );
      const updatedImage = updatedImages.find((img) => img.id === imageId);
      if (updatedImage) {
        await projectDB.updateImage(updatedImage);
      }
      setImages(updatedImages);
    },
    [images]
  );

  const updateImage = useCallback(async (image: ImageAsset) => {
    // Update the image in the library (source of truth)
    // No cascade needed - patterns reference by ID and will get updates automatically
    await projectDB.updateImage(image);
    setImages((prev) => prev.map((img) => (img.id === image.id ? image : img)));
  }, []);

  // Helper: Resolve image by ID from library
  const getImageById = useCallback(
    (imageId: string | undefined): ImageAsset | null => {
      if (!imageId) return null;
      return images.find((img) => img.id === imageId) || null;
    },
    [images]
  );

  // Helper: Resolve pattern's image data from library
  const resolvePatternImage = useCallback(
    (pattern: Pattern): { url: string; mask?: string } | null => {
      // Fallback for when migration hasn't run yet or for transient bad data
      // If imageId is actually the base64 data, return it directly
      if (pattern.imageId && pattern.imageId.startsWith("data:image")) {
        return { url: pattern.imageId };
      }

      if (!pattern.imageId) {
        // Pattern has no imageId - this is a data issue
        return null;
      }
      const image = getImageById(pattern.imageId);
      if (!image) {
        console.warn(
          `[resolvePatternImage] Image not found: ${pattern.imageId} (pattern: ${pattern.id})`
        );
        return null;
      }
      return { url: image.url, mask: image.mask };
    },
    [getImageById]
  );

  // Get detailed usage information for an image
  const getImageUsage = useCallback(
    (imageId: string) => {
      const image = images.find((img) => img.id === imageId);
      if (!image) {
        return { states: [], processes: [] };
      }

      // Find states that use this image by checking pattern imageIds
      const usedInStates = states
        .filter((state) =>
          state.stateImages?.some((si) =>
            si.patterns?.some((p) => p.imageId === imageId)
          )
        )
        .map((state) => ({
          id: state.id,
          name: state.name || state.id,
        }));

      // Find workflows that use this image in actions
      const usedInProcesses: Array<{
        id: string;
        name: string;
        actionCount: number;
      }> = [];

      workflows.forEach((workflow) => {
        const actionsWithImage = workflow.actions.filter((action) => {
          // Check if action uses this image in new target structure
          if (
            "target" in action.config &&
            typeof action.config.target === "object" &&
            action.config.target?.type === "image"
          ) {
            // Handle both single imageId and array imageIds
            if (
              "imageId" in action.config.target &&
              action.config.target.imageId === imageId
            )
              return true;
            if (
              "imageIds" in action.config.target &&
              Array.isArray(action.config.target.imageIds) &&
              action.config.target.imageIds.includes(imageId)
            )
              return true;
          }
          // Check legacy format
          if ("image" in action.config && action.config.image === imageId)
            return true;
          // Check DRAG actions (to field)
          if (
            action.type === "DRAG" &&
            "to" in action.config &&
            action.config.to === imageId
          )
            return true;
          return false;
        });

        if (actionsWithImage.length > 0) {
          usedInProcesses.push({
            id: workflow.id,
            name: workflow.name || workflow.id,
            actionCount: actionsWithImage.length,
          });
        }
      });

      return {
        states: usedInStates,
        processes: usedInProcesses,
      };
    },
    [images, states, workflows]
  );

  // Remove image from all states
  const removeImageFromStates = useCallback(
    async (imageUrl: string) => {
      const affectedStates = states.filter((state) =>
        state.stateImages?.some((si) => "image" in si && si.image === imageUrl)
      );

      for (const state of affectedStates) {
        const updatedState = {
          ...state,
          stateImages: state.stateImages.filter(
            (si) => !("image" in si) || si.image !== imageUrl
          ),
        };
        await projectDB.updateState(updatedState);
        setStates((prev) =>
          prev.map((s) => (s.id === state.id ? updatedState : s))
        );
      }

      return affectedStates.length;
    },
    [states]
  );

  // Mark image as removed in workflows
  const markImageAsRemovedInProcesses = useCallback(
    async (imageId: string, imageName: string) => {
      const affectedWorkflows: Workflow[] = [];

      for (const workflow of workflows) {
        let hasChanges = false;
        const updatedActions = workflow.actions.map((action) => {
          // Check if action uses this image in new target structure
          if (
            "target" in action.config &&
            typeof action.config.target === "object" &&
            action.config.target?.type === "image" &&
            "imageId" in action.config.target &&
            action.config.target.imageId === imageId
          ) {
            hasChanges = true;
            return {
              ...action,
              config: {
                ...action.config,
                target: {
                  type: "image",
                  imageId: null,
                },
                removedImage: imageName, // Store the original image name
              },
            };
          }
          // Check legacy format
          if ("image" in action.config && action.config.image === imageId) {
            hasChanges = true;
            return {
              ...action,
              config: {
                ...action.config,
                image: null,
                removedImage: imageName, // Store the original image name
              },
            };
          }
          // Check DRAG actions (to field)
          if (
            action.type === "DRAG" &&
            "to" in action.config &&
            action.config.to === imageId
          ) {
            hasChanges = true;
            return {
              ...action,
              config: {
                ...action.config,
                to: null,
                removedImageTo: imageName,
              },
            };
          }
          return action;
        });

        if (hasChanges) {
          const updatedWorkflow = {
            ...workflow,
            actions: updatedActions as Workflow["actions"],
          };
          const workflowWithProject = {
            ...updatedWorkflow,
            projectName,
          } as Workflow & { projectName: string };
          await projectDB.updateWorkflow(workflowWithProject);
          setWorkflows((prev) =>
            prev.map((w) => (w.id === workflow.id ? updatedWorkflow : w))
          );
          affectedWorkflows.push(updatedWorkflow);
        }
      }

      return affectedWorkflows.length;
    },
    [workflows, projectName]
  );

  // Screenshot management functions (using IndexedDB)
  const addScreenshot = useCallback(
    async (screenshot: Screenshot) => {
      // Normalize the URL to ensure it&apos;s absolute (e.g., http://localhost:8000/uploads/...)
      const normalizedScreenshot = {
        ...screenshot,
        url: normalizeUrl(screenshot.url),
        projectName,
      };
      await screenshotDB.add(normalizedScreenshot);
      setScreenshots((prev) =>
        ScreenshotManager.addScreenshot(prev, normalizedScreenshot)
      );
    },
    [projectName]
  );

  const updateScreenshot = useCallback(async (screenshot: Screenshot) => {
    // Normalize the URL to ensure it&apos;s absolute
    const normalizedScreenshot = {
      ...screenshot,
      url: normalizeUrl(screenshot.url),
    };
    await screenshotDB.update(normalizedScreenshot);
    setScreenshots((prev) =>
      ScreenshotManager.updateScreenshot(prev, normalizedScreenshot)
    );
  }, []);

  const deleteScreenshot = useCallback(async (screenshotId: string) => {
    await screenshotDB.delete(screenshotId);
    setScreenshots((prev) =>
      ScreenshotManager.deleteScreenshot(prev, screenshotId)
    );
  }, []);

  // Auto-save
  const triggerSave = useCallback(() => {
    const timestamp = new Date().toISOString();
    setLastSaved(timestamp);

    // Track local save time to prevent backend from overwriting newer local data
    // This protects against data loss during session expiry + backend save failures
    if (typeof window !== "undefined" && projectName) {
      const saveTimeKey = `qontinui-local-save-time:${projectName}`;
      localStorage.setItem(saveTimeKey, timestamp);
    }
  }, [setLastSaved, projectName]);

  // ActionHistory management functions
  const updateStateImageActionHistory = useCallback(
    (stateId: string, imageId: string, actionHistory: ActionHistory) => {
      setStates((prev) =>
        prev.map((state) => {
          if (state.id === stateId) {
            return ActionHistoryManager.updateStateImageActionHistory(
              state,
              imageId,
              actionHistory
            );
          }
          return state;
        })
      );
      triggerSave();
    },
    [triggerSave]
  );

  const updateStateLocationActionHistory = useCallback(
    (stateId: string, locationId: string, actionHistory: ActionHistory) => {
      setStates((prev) =>
        prev.map((state) => {
          if (state.id === stateId) {
            return ActionHistoryManager.updateStateLocationActionHistory(
              state,
              locationId,
              actionHistory
            );
          }
          return state;
        })
      );
      triggerSave();
    },
    [triggerSave]
  );

  const updateStateRegionActionHistory = useCallback(
    (stateId: string, regionId: string, actionHistory: ActionHistory) => {
      setStates((prev) =>
        prev.map((state) => {
          if (state.id === stateId) {
            return ActionHistoryManager.updateStateRegionActionHistory(
              state,
              regionId,
              actionHistory
            );
          }
          return state;
        })
      );
      triggerSave();
    },
    [triggerSave]
  );

  // Category management functions
  const addCategory = useCallback((category: string) => {
    setCategories((prev) => {
      if (!prev.includes(category)) {
        return [...prev, category];
      }
      return prev;
    });
  }, []);

  const deleteCategory = useCallback((category: string) => {
    // Protect Main and transition categories from deletion
    const protectedCategories = [
      "Main",
      "Incoming Transitions",
      "Outgoing Transitions",
    ];
    if (protectedCategories.includes(category)) {
      console.warn(`Cannot delete protected category: ${category}`);
      return;
    }
    setCategories((prev) => prev.filter((c) => c !== category));
  }, []);

  // Scheduler management functions
  const addSchedule = useCallback(
    (schedule: Schedule) => {
      const scheduleWithProject = { ...schedule, projectName };
      setSchedules((prev) => [...prev, scheduleWithProject]);
      triggerSave();
    },
    [projectName, triggerSave]
  );

  const updateSchedule = useCallback(
    (schedule: Schedule) => {
      setSchedules((prev) =>
        prev.map((s) => (s.id === schedule.id ? schedule : s))
      );
      triggerSave();
    },
    [triggerSave]
  );

  const deleteSchedule = useCallback(
    (scheduleId: string) => {
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
      // Also remove associated execution records
      setExecutionRecords((prev) =>
        prev.filter((r) => r.scheduleId !== scheduleId)
      );
      triggerSave();
    },
    [triggerSave]
  );

  const getSchedulerStatistics = useCallback((): SchedulerStatistics => {
    const totalSchedules = schedules.length;
    const activeSchedules = schedules.filter((s) => s.enabled).length;
    const totalExecutions = executionRecords.length;
    const successfulExecutions = executionRecords.filter(
      (r) => r.success
    ).length;
    const failedExecutions = executionRecords.filter((r) => !r.success).length;
    const averageIterationCount =
      executionRecords.length > 0
        ? executionRecords.reduce((sum, r) => sum + r.iterationCount, 0) /
          executionRecords.length
        : 0;

    return {
      totalSchedules,
      activeSchedules,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageIterationCount,
    };
  }, [schedules, executionRecords]);

  const getScheduleExecutions = useCallback(
    (scheduleId: string): ExecutionRecord[] => {
      return executionRecords.filter((r) => r.scheduleId === scheduleId);
    },
    [executionRecords]
  );

  // Settings management functions
  const updateSettings = useCallback(
    (newSettings: ProjectSettings) => {
      setSettings(newSettings);
      triggerSave();
    },
    [setSettings, triggerSave]
  );

  // Get full configuration for export/save
  const getConfiguration = useCallback(() => {
    return {
      name: projectName,
      images,
      screenshots,
      workflows,
      states,
      transitions,
      categories,
      settings,
      schedules,
      executionRecords,
      metadata: {
        lastSaved: lastSaved,
        version: "1.0.0",
      },
    };
  }, [
    projectName,
    images,
    workflows,
    states,
    transitions,
    categories,
    settings,
    schedules,
    executionRecords,
    lastSaved,
  ]);

  // Sync screenshots from backend database
  const syncScreenshotsFromBackend = useCallback(
    async (projectIdToSync: string) => {
      if (!projectIdToSync) {
        projectLogger.warn(
          "syncScreenshotsFromBackend",
          "No project ID provided"
        );
        return;
      }

      try {
        projectLogger.configLoader("Fetching screenshots from backend", {
          projectId: projectIdToSync,
        });

        const response = await apiClient.listProjectScreenshots(
          projectIdToSync,
          { limit: 100 }
        );

        projectLogger.configLoader("Screenshots fetched from backend", {
          count: response.screenshots.length,
          total: response.total,
        });

        // Convert backend screenshots to local format and add to IndexedDB
        const backendScreenshots = response.screenshots.map((s) => ({
          id: s.id,
          name: s.name,
          url: normalizeUrl(s.presigned_url),
          size: s.file_size,
          uploadedAt: new Date(s.created_at),
          projectName: projectName,
          // Additional metadata that might be useful
          source: s.source,
          width: s.width,
          height: s.height,
        }));

        // Update IndexedDB
        for (const screenshot of backendScreenshots) {
          await screenshotDB.update(screenshot);
        }

        // Update state
        setScreenshots(backendScreenshots);

        projectLogger.configLoader("Screenshots synced from backend", {
          count: backendScreenshots.length,
        });
      } catch (error) {
        // Check if this is a PROJECT_NOT_FOUND error (stale project ID)
        const errorObj = error as Error & { code?: string; status?: number };
        if (
          errorObj?.code === "PROJECT_NOT_FOUND" ||
          errorObj?.status === 404
        ) {
          projectLogger.warn(
            "syncScreenshotsFromBackend",
            "Project not found - clearing stale project ID",
            { projectId: projectIdToSync }
          );
          // Clear the stale project ID from localStorage
          setProjectId(null);
          return;
        }

        projectLogger.error(
          "syncScreenshotsFromBackend",
          "Failed to sync screenshots from backend",
          { error, projectId: projectIdToSync }
        );
        // Don't throw - screenshots failing shouldn&apos;t block project load
      }
    },
    [projectName, setProjectId]
  );

  // Auto-sync screenshots when projectId changes
  useEffect(() => {
    if (projectId && !isLoadingFromBackend) {
      syncScreenshotsFromBackend(projectId);
    }
  }, [projectId, isLoadingFromBackend, syncScreenshotsFromBackend]);

  // Load a complete configuration
  const loadConfiguration = useCallback(
    async (config: unknown) => {
      const newProjectName = config.name || "Untitled Project";

      // Check if the incoming config has any data
      const configHasData =
        (config.workflows?.length ?? 0) > 0 ||
        (config.states?.length ?? 0) > 0 ||
        (config.transitions?.length ?? 0) > 0 ||
        (config.images?.length ?? 0) > 0;

      projectLogger.configLoader("loadConfiguration START", {
        newProjectName,
        oldProjectName: projectName,
        hasWorkflows: !!config.workflows,
        workflowCount: config.workflows?.length ?? 0,
        stateCount: config.states?.length ?? 0,
        transitionCount: config.transitions?.length ?? 0,
        imageCount: config.images?.length ?? 0,
        configHasData,
      });

      // SAFETY: If backend returns empty config, try to load from IndexedDB
      // This handles the case where backend has been corrupted or reset
      // but we still have data locally (especially important since we skip
      // IndexedDB load when isLoadingFromBackend is true)
      if (!configHasData) {
        projectLogger.warn(
          "configLoader",
          "Backend config is empty - attempting to load from IndexedDB",
          {
            newProjectName,
            oldProjectName: projectName,
          }
        );

        // Try to load from IndexedDB for this project
        try {
          const [
            loadedWorkflows,
            loadedStates,
            loadedTransitions,
            loadedImages,
          ] = await Promise.all([
            projectDB.getWorkflowsByProject(newProjectName),
            projectDB.getStatesByProject(newProjectName),
            projectDB.getTransitionsByProject(newProjectName),
            projectDB.getImagesByProject(newProjectName),
          ]);

          const hasLocalData =
            loadedWorkflows.length > 0 ||
            loadedStates.length > 0 ||
            loadedTransitions.length > 0 ||
            loadedImages.length > 0;

          if (hasLocalData) {
            projectLogger.info(
              "configLoader",
              "Found local data in IndexedDB - restoring",
              {
                projectName: newProjectName,
                workflowCount: loadedWorkflows.length,
                stateCount: loadedStates.length,
                transitionCount: loadedTransitions.length,
                imageCount: loadedImages.length,
              }
            );

            // Set the data from IndexedDB to React Context
            setWorkflows(loadedWorkflows);
            setStates(loadedStates);
            setTransitions(loadedTransitions);
            setImages(loadedImages);
            setProjectName(newProjectName);

            // Also sync to Zustand store for UI components that read from there
            // (StateStructure, etc. use useStates() which reads from Zustand, not Context)
            const zustandStore = useAutomationStore.getState();
            await zustandStore.loadConfiguration({
              name: newProjectName,
              workflows: loadedWorkflows,
              states: loadedStates,
              transitions: loadedTransitions,
              images: loadedImages,
            });

            projectLogger.info(
              "configLoader",
              "Synced IndexedDB data to Zustand store",
              { projectName: newProjectName }
            );
          } else {
            projectLogger.warn(
              "configLoader",
              "No local data found in IndexedDB either",
              { projectName: newProjectName }
            );
          }
        } catch (error) {
          projectLogger.error("configLoader", "Failed to load from IndexedDB", {
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        return;
      }

      // NOTE: Previously had a timestamp safety check here that compared local save time
      // vs backend save time to prevent data loss. However, this was too aggressive and
      // blocked legitimate project loads when the user explicitly selected a project.
      //
      // The timestamp check has been removed because:
      // 1. When user clicks on a project, they WANT to load that project's data
      // 2. When user imports a file, they WANT to load that file's data
      // 3. Auto-save to backend happens frequently, so data loss is minimal
      // 4. IndexedDB still has local data as a backup
      //
      // If data loss becomes an issue, consider adding back with a user confirmation dialog
      // instead of silently blocking the load.

      // Clear the local save timestamp when loading new data
      if (typeof window !== "undefined" && newProjectName) {
        const saveTimeKey = `qontinui-local-save-time:${newProjectName}`;
        localStorage.removeItem(saveTimeKey);
        projectLogger.configLoader(
          "Cleared local save timestamp for new load",
          {
            projectName: newProjectName,
          }
        );
      }

      // Clear existing data for the old project from IndexedDB
      projectLogger.indexedDB("Clearing old project data", { projectName });
      await projectDB.clearProjectData(projectName);

      const currentScreenshots = await screenshotDB.getByProject(projectName);
      for (const screenshot of currentScreenshots) {
        await screenshotDB.delete(screenshot.id);
      }
      projectLogger.indexedDB("Old project data cleared", {
        projectName,
        screenshotsDeleted: currentScreenshots.length,
      });

      if (config.name) {
        projectLogger.configLoader("Setting project name", {
          from: projectName,
          to: config.name,
        });
        setProjectName(config.name);
      }

      // Load workflows to IndexedDB
      if (config.workflows && Array.isArray(config.workflows)) {
        projectLogger.configLoader("Loading workflows", {
          count: config.workflows.length,
        });
        const workflowsWithProject = config.workflows.map((w: Workflow) => ({
          ...w,
          projectName: newProjectName,
        })) as Array<Workflow & { projectName: string }>;
        for (const workflow of workflowsWithProject) {
          await projectDB.updateWorkflow(workflow);
        }
        setWorkflows(config.workflows);
        projectLogger.configLoader("Workflows loaded and state set", {
          count: config.workflows.length,
        });
      } else {
        projectLogger.configLoader(
          "No workflows in config, setting empty array"
        );
        setWorkflows([]);
      }

      // Load states to IndexedDB
      if (config.states && Array.isArray(config.states)) {
        projectLogger.configLoader("Loading states", {
          count: config.states.length,
        });
        const statesWithProject = config.states.map((s: State) => ({
          ...s,
          projectName: newProjectName,
        }));
        for (const state of statesWithProject) {
          await projectDB.updateState(state);
        }
        setStates(statesWithProject);
        projectLogger.configLoader("States loaded and state set", {
          count: statesWithProject.length,
        });
      } else {
        projectLogger.configLoader("No states in config, setting empty array");
        setStates([]);
      }

      // Load transitions to IndexedDB
      if (config.transitions && Array.isArray(config.transitions)) {
        projectLogger.configLoader("Loading transitions", {
          count: config.transitions.length,
        });
        const transitionsWithProject = config.transitions.map(
          (t: Transition) => ({
            ...t,
            projectName: newProjectName,
          })
        );
        for (const transition of transitionsWithProject) {
          await projectDB.updateTransition(transition);
        }
        setTransitions(transitionsWithProject);
        projectLogger.configLoader("Transitions loaded and state set", {
          count: transitionsWithProject.length,
        });
      } else {
        projectLogger.configLoader(
          "No transitions in config, setting empty array"
        );
        setTransitions([]);
      }

      // Load images to IndexedDB
      if (config.images && Array.isArray(config.images)) {
        projectLogger.configLoader("Loading images", {
          count: config.images.length,
        });
        const imagesWithProject = config.images.map((img: ImageAsset) => ({
          ...img,
          projectName: newProjectName,
        }));
        for (const image of imagesWithProject) {
          await projectDB.updateImage(image);
        }
        setImages(imagesWithProject);
        projectLogger.configLoader("Images loaded and state set", {
          count: imagesWithProject.length,
        });
      } else {
        projectLogger.configLoader("No images in config, setting empty array");
        setImages([]);
      }

      // Load screenshots to IndexedDB
      if (config.screenshots && Array.isArray(config.screenshots)) {
        projectLogger.configLoader("Loading screenshots", {
          count: config.screenshots.length,
        });
        const screenshotsWithProject = config.screenshots.map(
          (s: Screenshot) => ({
            ...s,
            projectName: newProjectName,
          })
        );
        for (const screenshot of screenshotsWithProject) {
          await screenshotDB.update(screenshot);
        }
        setScreenshots(screenshotsWithProject);
        projectLogger.configLoader("Screenshots loaded and state set", {
          count: screenshotsWithProject.length,
        });
      } else {
        projectLogger.configLoader(
          "No screenshots in config, setting empty array"
        );
        setScreenshots([]);
      }

      if (config.categories && Array.isArray(config.categories)) {
        const uniqueCategories = Array.from(
          new Set([
            "Main",
            "Incoming Transitions",
            "Outgoing Transitions",
            ...config.categories,
          ])
        );
        setCategories(uniqueCategories);
        projectLogger.configLoader("Categories set", {
          count: uniqueCategories.length,
        });
      } else {
        setCategories(["Main", "Incoming Transitions", "Outgoing Transitions"]);
        projectLogger.configLoader("Using default categories");
      }

      // Load schedules
      if (config.schedules && Array.isArray(config.schedules)) {
        projectLogger.configLoader("Loading schedules", {
          count: config.schedules.length,
        });
        const schedulesWithProject = config.schedules.map((s: Schedule) => ({
          ...s,
          projectName: newProjectName,
          createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
          lastExecutedAt: s.lastExecutedAt
            ? new Date(s.lastExecutedAt)
            : undefined,
        }));
        setSchedules(schedulesWithProject);
      }

      // Load execution records
      if (config.executionRecords && Array.isArray(config.executionRecords)) {
        const recordsWithDates = config.executionRecords.map(
          (r: ExecutionRecord) => ({
            ...r,
            startTime: new Date(r.startTime),
            endTime: r.endTime ? new Date(r.endTime) : undefined,
          })
        );
        setExecutionRecords(recordsWithDates);
      }

      // Don't load settings from config - they should be local defaults
      // Settings are now per-project in localStorage, not saved in config

      projectLogger.configLoader("loadConfiguration COMPLETE", {
        projectName: newProjectName,
      });

      // Sync screenshots from backend database if project has an ID
      if (projectId) {
        projectLogger.configLoader("Syncing screenshots from backend", {
          projectId,
        });
        await syncScreenshotsFromBackend(projectId);
      }

      triggerSave();
    },
    [
      projectName,
      setProjectName,
      setCategories,
      triggerSave,
      projectId,
      syncScreenshotsFromBackend,
    ]
  );

  // Clear all data for new project
  const clearAllData = useCallback(async () => {
    // Clear all data from IndexedDB for current project
    await projectDB.clearProjectData(projectName);

    const currentScreenshots = await screenshotDB.getByProject(projectName);
    for (const screenshot of currentScreenshots) {
      await screenshotDB.delete(screenshot.id);
    }

    setProjectName("Untitled Project");
    setImages([]);
    setScreenshots([]);
    setWorkflows([]);
    setStates([]);
    setTransitions([]);
    setCategories(["Main", "Incoming Transitions", "Outgoing Transitions"]);
    setSchedules([]);
    setExecutionRecords([]);
    setLastSaved(null);
  }, [projectName, setProjectName, setCategories, setLastSaved]);

  // Rename project - updates both localStorage and IndexedDB
  const renameProject = useCallback(
    async (newName: string) => {
      const trimmedName = newName.trim();
      if (!trimmedName || trimmedName === projectName) {
        return;
      }

      console.log(`Renaming project from "${projectName}" to "${trimmedName}"`);

      // Rename all data in IndexedDB first
      await projectDB.renameProject(projectName, trimmedName);
      await screenshotDB.renameProject(projectName, trimmedName);

      // Update in-memory state with new project names (without triggering reload)
      setWorkflows((prev) =>
        prev.map((w) => ({ ...w, projectName: trimmedName }))
      );
      setStates((prev) =>
        prev.map((s) => ({ ...s, projectName: trimmedName }))
      );
      setTransitions((prev) =>
        prev.map((t) => ({ ...t, projectName: trimmedName }))
      );
      setImages((prev) =>
        prev.map((i) => ({ ...i, projectName: trimmedName }))
      );
      setScreenshots((prev) =>
        prev.map((s) => ({ ...s, projectName: trimmedName }))
      );

      // Set flag to prevent useEffect from reloading when projectName changes
      isRenamingRef.current = true;

      // Update the project name in localStorage (this will trigger useEffect, but we'll skip the reload)
      setProjectName(trimmedName);

      console.log(`Project renamed successfully to "${trimmedName}"`);

      // Trigger save
      triggerSave();
    },
    [projectName, setProjectName, triggerSave]
  );

  const contextValue: AutomationContextType = useMemo(
    () => ({
      // Project
      projectName,
      setProjectName,
      renameProject,
      projectId,
      setProjectId,

      // Workflow management (unified - replaces both processes and workflows)
      workflows,
      addWorkflow,
      updateWorkflow,
      deleteWorkflow,

      // State management
      states,
      addState,
      updateState,
      updateStateWithIdChange,
      deleteState,

      // Transition management
      transitions,
      addTransition,
      updateTransition,
      deleteTransition,

      // Image management
      images,
      addImage,
      deleteImage,
      updateImage,
      updateImageUsage,
      removeImageUsage,
      getImageUsage,
      removeImageFromStates,
      markImageAsRemovedInProcesses,
      getImageById,
      resolvePatternImage,

      // Screenshot management
      screenshots,
      addScreenshot,
      updateScreenshot,
      deleteScreenshot,

      // ActionHistory management
      updateStateImageActionHistory,
      updateStateLocationActionHistory,
      updateStateRegionActionHistory,

      // Category management
      categories,
      addCategory,
      deleteCategory,

      // Scheduler management
      schedules,
      addSchedule,
      updateSchedule,
      deleteSchedule,
      getSchedulerStatistics,

      // Execution history
      executionRecords,
      getScheduleExecutions,

      // Settings management
      settings,
      updateSettings,

      // Auto-save
      lastSaved,
      triggerSave,

      // Configuration
      getConfiguration,
      loadConfiguration,
      clearAllData,
      syncScreenshotsFromBackend,

      // Backend loading control
      isLoadingFromBackend,
      setIsLoadingFromBackend,
    }),
    [
      projectName,
      setProjectName,
      renameProject,
      projectId,
      setProjectId,
      workflows,
      addWorkflow,
      updateWorkflow,
      deleteWorkflow,
      states,
      addState,
      updateState,
      updateStateWithIdChange,
      deleteState,
      transitions,
      addTransition,
      updateTransition,
      deleteTransition,
      images,
      addImage,
      deleteImage,
      updateImage,
      updateImageUsage,
      removeImageUsage,
      getImageUsage,
      removeImageFromStates,
      markImageAsRemovedInProcesses,
      screenshots,
      addScreenshot,
      updateScreenshot,
      deleteScreenshot,
      updateStateImageActionHistory,
      updateStateLocationActionHistory,
      updateStateRegionActionHistory,
      categories,
      addCategory,
      deleteCategory,
      schedules,
      addSchedule,
      updateSchedule,
      deleteSchedule,
      getSchedulerStatistics,
      executionRecords,
      getScheduleExecutions,
      settings,
      updateSettings,
      lastSaved,
      triggerSave,
      getConfiguration,
      loadConfiguration,
      clearAllData,
      syncScreenshotsFromBackend,
      isLoadingFromBackend,
      setIsLoadingFromBackend,
    ]
  );

  return (
    <AutomationContext.Provider value={contextValue}>
      {children}
    </AutomationContext.Provider>
  );
}
