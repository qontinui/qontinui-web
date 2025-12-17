/**
 * useProjectAutoSave Hook
 *
 * Single Responsibility: Handle automatic saving of project configuration.
 * This hook extracts the auto-save logic from the automation-builder component.
 *
 * Responsibilities:
 * - Trigger local storage saves periodically
 * - Sync configuration to backend periodically
 * - Track save status
 */

import { useEffect, useCallback, useRef } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { projectService } from "@/services/service-factory";
import { projectLogger } from "@/lib/project-logger";

interface UseProjectAutoSaveOptions {
  /** Project ID for backend sync (null if no backend project) */
  projectId: string | null;
  /** Interval for local saves in ms (default: 2000) */
  localSaveInterval?: number;
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
}

export function useProjectAutoSave({
  projectId,
  localSaveInterval = 2000,
  backendSaveInterval = 10000,
  enabled = true,
}: UseProjectAutoSaveOptions): UseProjectAutoSaveResult {
  const {
    triggerSave,
    getConfiguration,
    workflows,
    states,
    transitions,
    images,
    isLoadingFromBackend,
  } = useAutomation();

  const isSavingRef = useRef(false);

  // Save to backend
  const saveToBackend = useCallback(async () => {
    // Don't save if we're currently loading from backend - this prevents
    // overwriting backend data with empty/partial local state
    if (isLoadingFromBackend) {
      projectLogger.debug("AutoSave", "Skipping save - loading from backend", {
        projectId,
      });
      return;
    }

    if (!projectId || isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;

    try {
      const config = getConfiguration();

      // Safety check: don't save if configuration appears to be empty/invalid
      // This prevents accidental data loss from race conditions
      const hasData =
        (config.workflows?.length ?? 0) > 0 ||
        (config.states?.length ?? 0) > 0 ||
        (config.transitions?.length ?? 0) > 0 ||
        (config.images?.length ?? 0) > 0;

      if (!hasData) {
        projectLogger.warn(
          "AutoSave",
          "Skipping save - configuration appears empty",
          {
            projectId,
            workflowCount: config.workflows?.length ?? 0,
            stateCount: config.states?.length ?? 0,
            transitionCount: config.transitions?.length ?? 0,
            imageCount: config.images?.length ?? 0,
          }
        );
        return;
      }

      projectLogger.debug("AutoSave", "Saving to backend", {
        projectId,
        workflowCount: config.workflows?.length ?? 0,
        stateCount: config.states?.length ?? 0,
      });

      await projectService.updateProject(projectId, {
        configuration: config,
      });

      projectLogger.debug("AutoSave", "Backend save complete", { projectId });
    } catch (error) {
      projectLogger.error("AutoSave", "Backend save failed", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId, getConfiguration, isLoadingFromBackend]);

  // Auto-save to localStorage
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      triggerSave();
    }, localSaveInterval);

    return () => clearInterval(interval);
  }, [triggerSave, localSaveInterval, enabled]);

  // Auto-save to backend
  useEffect(() => {
    if (!enabled || !projectId) return;

    const interval = setInterval(() => {
      saveToBackend();
    }, backendSaveInterval);

    return () => clearInterval(interval);
  }, [
    projectId,
    saveToBackend,
    backendSaveInterval,
    enabled,
    workflows,
    states,
    transitions,
    images,
  ]);

  // Save to backend when page is about to unload (refresh, close, navigate away)
  useEffect(() => {
    if (!enabled || !projectId) return;

    const handleBeforeUnload = () => {
      const config = getConfiguration();

      const hasData =
        (config.workflows?.length ?? 0) > 0 ||
        (config.states?.length ?? 0) > 0 ||
        (config.transitions?.length ?? 0) > 0 ||
        (config.images?.length ?? 0) > 0;

      if (!hasData) return;

      projectLogger.debug("AutoSave", "Saving on beforeunload", { projectId });

      // Use fetch with keepalive for reliable delivery during page unload
      // keepalive allows the request to outlive the page
      const backendUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const url = `${backendUrl}/api/v1/projects/${projectId}`;

      fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ configuration: config }),
        keepalive: true,
        credentials: "include",
      }).catch(() => {
        // Ignore errors during unload - best effort save
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled, projectId, getConfiguration]);

  return {
    saveToBackend,
    isSaving: isSavingRef.current,
  };
}
