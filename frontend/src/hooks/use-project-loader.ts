/**
 * useProjectLoader Hook
 *
 * Single Responsibility: Handle loading projects from backend based on URL parameters.
 * This hook extracts the project loading logic from the automation-builder component.
 *
 * Responsibilities:
 * - Extract project ID from URL search params
 * - Fetch project data from backend API
 * - Save current project before loading new one (prevents data loss)
 * - Trigger context's loadConfiguration
 * - Track loading state
 * - Handle errors
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { projectService } from "@/services/service-factory";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import { projectLogger } from "@/lib/project-logger";
import { toast } from "sonner";

interface UseProjectLoaderResult {
  /** Current project ID from backend (can be UUID string or numeric string) */
  projectId: string | null;
  /** Project ID from URL (string) */
  projectIdFromUrl: string | null;
  /** Whether a project is currently being loaded */
  isLoading: boolean;
  /** Last error that occurred during loading */
  error: string | null;
  /** Manually trigger a reload of the current project */
  reloadProject: () => Promise<void>;
}

export function useProjectLoader(): UseProjectLoaderResult {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track which project ID we've already loaded to prevent duplicate loads
  const loadedProjectIdRef = useRef<string | null>(null);
  // Track if a load is in progress to prevent concurrent loads
  const loadingRef = useRef(false);

  const {
    loadConfiguration,
    setProjectName,
    projectId: contextProjectId,
    setProjectId: setContextProjectId,
    setIsLoadingFromBackend,
    getConfiguration,
    states,
    workflows,
  } = useAutomation();

  // Extract project ID from URL as primitive value
  const projectIdFromUrl = searchParams?.get("project") || null;

  projectLogger.urlHandler("Extracted project ID from URL", {
    projectIdFromUrl,
    currentLoadedId: loadedProjectIdRef.current,
    isLoading: loadingRef.current,
  });

  // Core loading function
  const loadProject = useCallback(
    async (urlProjectId: string, force: boolean = false) => {
      // Debug: Log exactly what we received
      projectLogger.debug("ProjectLoader", "loadProject called", {
        urlProjectId,
        type: typeof urlProjectId,
        length: urlProjectId?.length,
        trimmed: urlProjectId?.trim(),
        isFalsy: !urlProjectId,
        isEmptyAfterTrim: urlProjectId?.trim() === "",
      });

      // Validate input - project IDs can be UUIDs or numeric strings
      // Accept any non-empty string
      if (
        !urlProjectId ||
        (typeof urlProjectId === "string" && urlProjectId.trim() === "")
      ) {
        projectLogger.warn(
          "ProjectLoader",
          "Invalid project ID - empty or falsy",
          { urlProjectId }
        );
        return;
      }

      // Skip duplicate load checks if force is true (manual reload)
      if (!force) {
        // Prevent duplicate loads - check both ref and context
        // The ref check prevents re-fetching within the same component lifecycle
        // The context check prevents re-fetching when navigating between pages
        // (preserves local IndexedDB data that hasn't been synced to backend yet)
        if (loadedProjectIdRef.current === urlProjectId) {
          projectLogger.debug(
            "ProjectLoader",
            "Project already loaded (ref match), skipping",
            {
              urlProjectId,
              loadedId: loadedProjectIdRef.current,
            }
          );
          return;
        }

        // If context already has this project loaded WITH DATA, skip backend fetch
        // This preserves local changes that haven't been auto-saved yet
        // IMPORTANT: Only skip if actual data exists - the projectId alone from
        // localStorage is not sufficient since the IndexedDB data may not be loaded
        const hasDataInContext = states.length > 0 || workflows.length > 0;
        if (contextProjectId === urlProjectId && hasDataInContext) {
          projectLogger.debug(
            "ProjectLoader",
            "Project already in context with data, skipping backend fetch",
            {
              urlProjectId,
              contextProjectId,
              stateCount: states.length,
              workflowCount: workflows.length,
            }
          );
          // Still mark as loaded in ref to prevent future redundant checks
          loadedProjectIdRef.current = urlProjectId;
          setProjectId(urlProjectId);

          // IMPORTANT: Ensure Zustand store is synced with context data
          // This is needed because components like StateStructure use useStates()
          // which reads from Zustand, not from the React Context
          const zustandStore = useAutomationStore.getState();
          const zustandStates = zustandStore.states;
          if (zustandStates.length === 0 && states.length > 0) {
            projectLogger.debug(
              "ProjectLoader",
              "Syncing context data to Zustand store",
              { stateCount: states.length, workflowCount: workflows.length }
            );
            zustandStore.loadConfiguration({
              workflows,
              states,
            });
          }
          return;
        }
      }

      // Prevent concurrent loads
      if (loadingRef.current) {
        projectLogger.warn(
          "ProjectLoader",
          "Load already in progress, skipping",
          {
            urlProjectId,
            loadedId: loadedProjectIdRef.current,
          }
        );
        return;
      }

      projectLogger.projectLoader("Starting project load", {
        urlProjectId,
        previousLoadedId: loadedProjectIdRef.current,
        currentContextProjectId: contextProjectId,
      });

      // CRITICAL: Mark this project as being loaded BEFORE any async operations
      // This prevents the useEffect from re-triggering due to dependency changes
      // (like workflows.length) during async operations in loadConfiguration.
      // Without this, the effect could re-run with stale ref and cause duplicate loads.
      loadedProjectIdRef.current = urlProjectId;

      loadingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        // CRITICAL: Save current project to backend BEFORE loading the new one
        // This prevents data loss when navigating between pages/projects
        if (contextProjectId && contextProjectId !== urlProjectId) {
          projectLogger.projectLoader(
            "Saving current project before loading new one",
            {
              currentProjectId: contextProjectId,
              newProjectId: urlProjectId,
            }
          );

          try {
            const currentConfig = getConfiguration();
            const hasData =
              (currentConfig.workflows?.length ?? 0) > 0 ||
              (currentConfig.states?.length ?? 0) > 0 ||
              (currentConfig.transitions?.length ?? 0) > 0 ||
              (currentConfig.images?.length ?? 0) > 0;

            if (hasData) {
              await projectService.updateProject(contextProjectId, {
                configuration: currentConfig,
              });
              projectLogger.projectLoader(
                "Current project saved successfully",
                {
                  projectId: contextProjectId,
                  workflowCount: currentConfig.workflows?.length ?? 0,
                  stateCount: currentConfig.states?.length ?? 0,
                }
              );
            } else {
              projectLogger.projectLoader(
                "Skipping save - current config is empty",
                { projectId: contextProjectId }
              );
            }
          } catch (saveError) {
            // Log error but continue with loading - don't block the user
            projectLogger.error(
              "ProjectLoader",
              "Failed to save current project before loading new one",
              {
                projectId: contextProjectId,
                error:
                  saveError instanceof Error
                    ? saveError.message
                    : "Unknown error",
              }
            );
          }
        }

        // Signal to context that we're loading from backend
        // This prevents the context's useEffect from overwriting our data
        setIsLoadingFromBackend(true);

        projectLogger.projectLoader("Fetching project from backend", {
          urlProjectId,
        });

        // Pass project ID as string - backend accepts both UUID and numeric IDs
        const project = await projectService.getProject(urlProjectId);

        const config = project.configuration as
          | {
              workflows?: unknown[];
              states?: unknown[];
              transitions?: unknown[];
              images?: unknown[];
              categories?: string[];
              settings?: unknown;
            }
          | null
          | undefined;

        projectLogger.projectLoader("Received project from backend", {
          projectId: project.id,
          projectName: project.name,
          hasConfiguration: !!project.configuration,
          workflowCount: config?.workflows?.length ?? 0,
          stateCount: config?.states?.length ?? 0,
        });

        // Load configuration into context
        // IMPORTANT: Use project.name (from project record) instead of config.name
        // because config.name might be "Untitled Project" if config is empty or corrupted
        projectLogger.configLoader("Calling loadConfiguration", {
          projectName: project.name,
        });

        const configWithCorrectName = {
          ...(project.configuration || {}),
          name: project.name, // Override with correct project name
        };
        await loadConfiguration(configWithCorrectName);

        // Also load into Zustand store for UI components that read from there
        // (StateStructure, etc. use useStates() which reads from Zustand, not Context)
        const zustandStore = useAutomationStore.getState();
        await zustandStore.loadConfiguration({
          name: project.name,
          workflows: config?.workflows,
          states: config?.states,
          transitions: config?.transitions,
          images: config?.images,
          categories: config?.categories,
          settings: config?.settings,
        });

        projectLogger.configLoader(
          "loadConfiguration completed (both stores)",
          {
            projectName: project.name,
          }
        );

        // Update project metadata
        setProjectName(project.name);
        setProjectId(String(project.id));
        setContextProjectId(String(project.id));

        projectLogger.projectLoader("Project load completed successfully", {
          projectId: project.id,
          projectName: project.name,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load project";
        projectLogger.error("ProjectLoader", "Failed to load project", {
          urlProjectId,
          error: errorMessage,
        });
        // Reset the ref on error so retry attempts can proceed
        loadedProjectIdRef.current = null;
        setError(errorMessage);
        toast.error("Failed to load project");
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
        // Clear the backend loading flag after a short delay to ensure state updates complete
        setTimeout(() => {
          setIsLoadingFromBackend(false);
          projectLogger.projectLoader("Backend loading flag cleared");
        }, 100);
      }
    },
    [
      loadConfiguration,
      setProjectName,
      setContextProjectId,
      setIsLoadingFromBackend,
      contextProjectId,
      getConfiguration,
      states.length,
      workflows.length,
    ]
  );

  // Effect to load project when URL changes
  useEffect(() => {
    projectLogger.urlHandler("URL project ID effect triggered", {
      projectIdFromUrl,
      loadedProjectIdRef: loadedProjectIdRef.current,
      contextProjectId,
    });

    if (projectIdFromUrl) {
      loadProject(projectIdFromUrl);
    } else if (contextProjectId) {
      // URL has no project ID, but context has one (from localStorage)
      // Load that project instead of resetting
      projectLogger.urlHandler(
        "No project ID in URL, using context project ID",
        {
          contextProjectId,
        }
      );
      loadProject(contextProjectId);
    }
    // Note: If neither URL nor context has a project ID, we don't reset anything.
    // The RequireProject component will show the "No project selected" message.
  }, [projectIdFromUrl, loadProject, contextProjectId]);

  // Manual reload function - forces a backend fetch even if project is already loaded
  const reloadProject = useCallback(async () => {
    if (projectIdFromUrl) {
      // Clear the loaded ref and force reload from backend
      loadedProjectIdRef.current = null;
      await loadProject(projectIdFromUrl, true);
    }
  }, [projectIdFromUrl, loadProject]);

  return {
    projectId,
    projectIdFromUrl,
    isLoading,
    error,
    reloadProject,
  };
}
