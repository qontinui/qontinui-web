/**
 * useProjectAutoSave Hook
 *
 * Single Responsibility: Handle automatic saving of project configuration.
 * This hook delegates sync operations to the SyncCoordinator.
 *
 * ARCHITECTURE:
 * - Uses SyncCoordinator with state machine, version tracking, and WebSocket
 * - Event-driven sync via ChangeTracker (replaces timer-based auto-save)
 * - Optimistic concurrency control with expected_version parameter
 *
 * Responsibilities:
 * - Initialize and configure SyncCoordinator
 * - Register save function with version handling
 * - Register reload function for lock release
 * - Track sync status for UI
 */

import { useEffect, useCallback, useState, useRef } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { projectService } from "@/services/service-factory";
import { syncCoordinator, type SyncStatus } from "@/lib/sync";
import { projectLogger } from "@/lib/project-logger";
import { getProjectLoader } from "@/lib/project/project-loader";

interface UseProjectAutoSaveOptions {
  /** Project ID for backend sync (null if no backend project) */
  projectId: string | null;
  /** Whether auto-save is enabled */
  enabled?: boolean;
  /** Change tracker settings (optional) */
  changeTrackerConfig?: {
    debounceDelay?: number;
    maxDelay?: number;
    maxPendingChanges?: number;
    fallbackInterval?: number;
  };
}

interface UseProjectAutoSaveResult {
  /** Manually trigger a save to backend */
  saveToBackend: () => Promise<void>;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Whether saves are blocked (locked, reloading, conflict) */
  isSaveBlocked: boolean;
  /** Full sync status */
  syncStatus: SyncStatus;
}

export function useProjectAutoSave({
  projectId,
  enabled = true,
  changeTrackerConfig,
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
  // Note: WebSocket auth uses cookies, not explicit token
  useEffect(() => {
    syncCoordinator.initialize({
      projectId,
      enabled,
      authToken: null, // WebSocket uses cookie-based auth
      changeTracker: changeTrackerConfig,
    });
  }, [projectId, enabled, changeTrackerConfig]);

  // Update loading state (legacy compatibility)
  useEffect(() => {
    syncCoordinator.setLoadingFromBackend(isLoadingFromBackend);
  }, [isLoadingFromBackend]);

  // Register save function with version handling
  useEffect(() => {
    const saveFn = async (expectedVersion: number | null) => {
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId) {
        return { success: false, error: "No project ID" };
      }

      const config = getConfigurationRef.current() as Record<string, unknown>;

      // Type assertion for configuration object
      const typedConfig = config as {
        workflows?: unknown[];
        states?: unknown[];
        [key: string]: unknown;
      };

      projectLogger.debug("AutoSave", "Saving to backend via coordinator", {
        projectId: currentProjectId,
        expectedVersion,
        workflowCount: typedConfig.workflows?.length ?? 0,
        stateCount: typedConfig.states?.length ?? 0,
      });

      try {
        // Build URL with expected_version for conditional update
        const baseUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        let url = `${baseUrl}/api/v1/projects/${currentProjectId}`;
        if (expectedVersion !== null) {
          url += `?expected_version=${expectedVersion}`;
        }

        // Use fetch with credentials: "include" for cookie-based auth
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ configuration: typedConfig }),
          credentials: "include",
        });

        if (response.ok) {
          const project = await response.json();
          projectLogger.debug("AutoSave", "Backend save complete", {
            projectId: currentProjectId,
            newVersion: project.version,
          });
          return { success: true, newVersion: project.version };
        } else if (response.status === 409) {
          // Version conflict
          const errorData = await response.json();
          projectLogger.warn("AutoSave", "Version conflict on save", {
            projectId: currentProjectId,
            expectedVersion,
            serverVersion: errorData.detail?.current_version,
          });
          return {
            success: false,
            isConflict: true,
            serverVersion: errorData.detail?.current_version,
            error: "Version conflict",
          };
        } else {
          const errorText = await response.text();
          projectLogger.error("AutoSave", "Backend save failed", {
            projectId: currentProjectId,
            status: response.status,
            error: errorText,
          });
          return { success: false, error: `Save failed: ${response.status}` };
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        projectLogger.error("AutoSave", "Backend save error", {
          projectId: currentProjectId,
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }
    };

    syncCoordinator.registerSaveFunction(saveFn);
  }, []);

  // Register reload function (for lock release)
  useEffect(() => {
    const reloadFn = async () => {
      const currentProjectId = projectIdRef.current;
      if (!currentProjectId) {
        throw new Error("No project ID");
      }

      projectLogger.debug("AutoSave", "Reloading from backend", {
        projectId: currentProjectId,
      });

      const projectLoader = getProjectLoader();
      await projectLoader.load(currentProjectId, { force: true });

      // Get the updated project to return the version
      const project = await projectService.getProject(currentProjectId);

      projectLogger.debug("AutoSave", "Reload complete", {
        projectId: currentProjectId,
        version: project.version,
      });

      return { version: project.version };
    };

    syncCoordinator.registerReloadFunction(reloadFn);
  }, []);

  // Register configuration getter
  useEffect(() => {
    syncCoordinator.registerConfigurationGetter(
      () => getConfigurationRef.current() as Record<string, unknown>
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
    isSaveBlocked: syncStatus.isSaveBlocked,
    syncStatus,
  };
}
