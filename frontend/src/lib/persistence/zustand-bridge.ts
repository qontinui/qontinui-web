/**
 * Zustand Bridge
 *
 * Provides backward compatibility by mapping the AutomationContextType interface
 * to the Zustand store. This allows gradual migration from Context to direct store usage.
 *
 * ARCHITECTURE:
 * - Zustand store is the SINGLE source of truth
 * - This bridge simply forwards all calls to the store
 * - No duplicate state management
 * - React Context uses this bridge to provide the same interface
 */

import { useCallback, useRef } from "react";
import { useAutomationStore } from "@/stores/automation";
import type {
  AutomationContextType,
  Transition,
} from "@/contexts/automation-context/types";

/**
 * Hook that provides the AutomationContextType interface backed by Zustand store.
 *
 * This is the bridge that allows existing components using useAutomation()
 * to continue working while we migrate to direct Zustand usage.
 */
export function useAutomationBridge(): AutomationContextType {
  // Get the store - this subscribes to changes
  const store = useAutomationStore();

  // Track immediate save time (for race condition prevention)
  const lastImmediateSaveRef = useRef<number>(0);

  // Wrap addTransition to return a Promise for backward compatibility
  // The store version is synchronous, but the context interface expected Promise
  const addTransitionAsync = useCallback(
    async (transition: Transition): Promise<boolean> => {
      return store.addTransition(transition);
    },
    [store]
  );

  // Provide the getLastImmediateSaveTime function
  const getLastImmediateSaveTime = useCallback(() => {
    return lastImmediateSaveRef.current;
  }, []);

  // Wrap triggerSave to track immediate save time
  const triggerSave = useCallback(() => {
    lastImmediateSaveRef.current = Date.now();
    store.triggerSave();
  }, [store]);

  // Wrap loadConfiguration to accept unknown (context interface) and cast to Record
  const loadConfiguration = useCallback(
    async (config: unknown): Promise<void> => {
      return store.loadConfiguration(config as Record<string, unknown>);
    },
    [store]
  );

  // Return the full context interface, delegating to store
  return {
    // Project metadata
    projectName: store.projectName,
    setProjectName: store.setProjectName,
    renameProject: store.renameProject,
    projectId: store.projectId,
    setProjectId: store.setProjectId,

    // Workflows
    workflows: store.workflows,
    addWorkflow: store.addWorkflow,
    updateWorkflow: store.updateWorkflow,
    deleteWorkflow: store.deleteWorkflow,
    deleteWorkflows: store.deleteWorkflows,

    // States
    states: store.states,
    addState: store.addState,
    updateState: store.updateState,
    updateStateWithIdChange: store.updateStateWithIdChange,
    deleteState: store.deleteState,

    // Transitions
    transitions: store.transitions,
    addTransition: addTransitionAsync,
    updateTransition: store.updateTransition,
    deleteTransition: store.deleteTransition,

    // Images
    images: store.images,
    addImage: store.addImage,
    deleteImage: store.deleteImage,
    updateImage: store.updateImage,
    updateImageUsage: store.updateImageUsage,
    removeImageUsage: store.removeImageUsage,
    getImageUsage: store.getImageUsage,
    removeImageFromStates: store.removeImageFromStates,
    markImageAsRemovedInProcesses: store.markImageAsRemovedInProcesses,
    getImageById: store.getImageById,
    resolvePatternImage: store.resolvePatternImage,

    // Screenshots
    screenshots: store.screenshots,
    addScreenshot: store.addScreenshot,
    updateScreenshot: store.updateScreenshot,
    deleteScreenshot: store.deleteScreenshot,

    // Action history
    updateStateImageActionHistory: store.updateStateImageActionHistory,
    updateStateLocationActionHistory: store.updateStateLocationActionHistory,
    updateStateRegionActionHistory: store.updateStateRegionActionHistory,

    // Auto-save
    lastSaved: store.lastSaved,
    triggerSave,

    // Categories
    categories: store.categories,
    addCategory: store.addCategory,
    deleteCategory: store.deleteCategory,

    // Settings
    settings: store.settings,
    updateSettings: store.updateSettings,

    // Schedules
    schedules: store.schedules,
    addSchedule: store.addSchedule,
    updateSchedule: store.updateSchedule,
    deleteSchedule: store.deleteSchedule,
    getSchedulerStatistics: store.getSchedulerStatistics,

    // Execution records
    executionRecords: store.executionRecords,
    getScheduleExecutions: store.getScheduleExecutions,

    // Configuration
    getConfiguration: store.getConfiguration,
    loadConfiguration,
    clearAllData: store.clearAllData,
    syncScreenshotsFromBackend: store.syncScreenshotsFromBackend,

    // Backend loading control
    isLoadingFromBackend: store.isLoadingFromBackend,
    setIsLoadingFromBackend: store.setIsLoadingFromBackend,

    // Immediate save tracking
    getLastImmediateSaveTime,
  };
}
