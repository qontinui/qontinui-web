/**
 * useProjectLoader Hook
 *
 * Single Responsibility: React hook for project loading.
 * Delegates core logic to ProjectLoaderService.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAutomationStore } from "@/stores/automation";
import { getProjectLoader, type LoadingContext } from "@/lib/project";
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
  /** Full loading context from state machine */
  loadingContext: LoadingContext;
}

export function useProjectLoader(): UseProjectLoaderResult {
  const searchParams = useSearchParams();
  const loader = getProjectLoader();

  // Get context project ID from store
  const contextProjectId = useAutomationStore((state) => state.projectId);

  // Track loading context
  const [loadingContext, setLoadingContext] = useState<LoadingContext>(
    loader.getContext()
  );

  // Track if we've already triggered a load for this URL
  const lastLoadedUrlRef = useRef<string | null>(null);

  // Extract project ID from URL
  const projectIdFromUrl = searchParams?.get("project") || null;

  projectLogger.urlHandler("Extracted project ID from URL", {
    projectIdFromUrl,
    contextProjectId,
    loaderState: loadingContext.state,
  });

  // Subscribe to loader state changes
  useEffect(() => {
    const unsubscribe = loader.subscribe((context) => {
      setLoadingContext(context);

      // Show toast on error
      if (context.state === "error" && context.error) {
        toast.error("Failed to load project");
      }
    });

    return unsubscribe;
  }, [loader]);

  // Load project when URL or context changes
  useEffect(() => {
    const projectIdToLoad = projectIdFromUrl || contextProjectId;

    if (!projectIdToLoad) {
      projectLogger.urlHandler("No project ID to load", {
        projectIdFromUrl,
        contextProjectId,
      });
      return;
    }

    // Skip if we already loaded this URL
    if (lastLoadedUrlRef.current === projectIdToLoad) {
      projectLogger.debug("ProjectLoader", "Already loaded this project", {
        projectIdToLoad,
      });
      return;
    }

    projectLogger.urlHandler("Triggering project load", {
      projectIdToLoad,
      source: projectIdFromUrl ? "url" : "context",
    });

    // Mark as loading this URL
    lastLoadedUrlRef.current = projectIdToLoad;

    // Load the project
    loader.load(projectIdToLoad, {
      currentProjectId: contextProjectId,
    });
  }, [projectIdFromUrl, contextProjectId, loader]);

  // Manual reload function
  const reloadProject = useCallback(async () => {
    const projectIdToReload = projectIdFromUrl || contextProjectId;
    if (projectIdToReload) {
      lastLoadedUrlRef.current = null;
      await loader.load(projectIdToReload, { force: true });
    }
  }, [projectIdFromUrl, contextProjectId, loader]);

  return {
    projectId: loader.getLoadedProjectId(),
    projectIdFromUrl,
    isLoading:
      loadingContext.state !== "idle" &&
      loadingContext.state !== "loaded" &&
      loadingContext.state !== "error",
    error: loadingContext.error,
    reloadProject,
    loadingContext,
  };
}
