/**
 * useProjectAutoSave Hook
 *
 * Single Responsibility: Handle automatic saving of project configuration.
 * This hook delegates sync operations to the SyncCoordinator.
 *
 * Responsibilities:
 * - Initialize and configure SyncCoordinator
 * - Register save function and configuration getter
 * - Track sync status for UI
 */

import { useEffect, useCallback, useState, useRef } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { projectService } from "@/services/service-factory";
import { syncCoordinator, type SyncStatus } from "@/lib/sync";
import { projectLogger } from "@/lib/project-logger";

interface UseProjectAutoSaveOptions {
  /** Project ID for backend sync (null if no backend project) */
  projectId: string | null;
  /** Interval for backend saves in ms (default: 10000) */
  backendSaveInterval?: number;
  /** Whether auto-save is enabled */
  enabled?: boolean;
}

interface UseProjectAutoSaveResult {
  /** Manually trigger a save to backend */
  saveToBackend: () => Promise<void>;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Full sync status */
  syncStatus: SyncStatus;
}

export function useProjectAutoSave({
  projectId,
  backendSaveInterval = 10000,
  enabled = true,
}: UseProjectAutoSaveOptions): UseProjectAutoSaveResult {
  const { getConfiguration, isLoadingFromBackend } = useAutomation();

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    syncCoordinator.getStatus()
  );

  // Keep refs to avoid stale closures
  const projectIdRef = useRef(projectId);
  const getConfigurationRef = useRef(getConfiguration);

  // Update refs when values change
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    getConfigurationRef.current = getConfiguration;
  }, [getConfiguration]);

  // Initialize coordinator
  useEffect(() => {
    syncCoordinator.initialize({
      projectId,
      enabled,
      backendSaveInterval,
    });
  }, [projectId, enabled, backendSaveInterval]);

  // Update loading state
  useEffect(() => {
    syncCoordinator.setLoadingFromBackend(isLoadingFromBackend);
  }, [isLoadingFromBackend]);

  // Register save function
  useEffect(() => {
    const saveFn = async () => {
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId) return;

      const config = getConfigurationRef.current();

      projectLogger.debug("AutoSave", "Saving to backend via coordinator", {
        projectId: currentProjectId,
        workflowCount: (config.workflows as unknown[])?.length ?? 0,
        stateCount: (config.states as unknown[])?.length ?? 0,
      });

      await projectService.updateProject(currentProjectId, {
        configuration: config,
      });

      projectLogger.debug("AutoSave", "Backend save complete", {
        projectId: currentProjectId,
      });
    };

    syncCoordinator.registerSaveFunction(saveFn);
  }, []);

  // Register configuration getter
  useEffect(() => {
    syncCoordinator.registerConfigurationGetter(() =>
      getConfigurationRef.current()
    );
  }, []);

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = syncCoordinator.subscribe(setSyncStatus);
    return unsubscribe;
  }, []);

  // Manual save trigger
  const saveToBackend = useCallback(async () => {
    await syncCoordinator.saveNow();
  }, []);

  return {
    saveToBackend,
    isSaving: syncStatus.isSyncing,
    syncStatus,
  };
}
