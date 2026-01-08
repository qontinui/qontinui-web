/**
 * Project Loader Service
 *
 * Core logic for loading projects from backend.
 * Uses state machine for predictable transitions.
 *
 * INTEGRATION WITH SYNC SYSTEM:
 * - Uses SyncCoordinator's state machine to coordinate reloads
 * - Updates VersionTracker after loading to track server version
 * - Cancels pending changes via ChangeTracker when force=true
 */

import { projectService } from "@/services/service-factory";
import { useAutomationStore } from "@/stores/automation";
import { syncCoordinator } from "@/lib/sync";
import { debounceManager } from "@/lib/sync/debounce-manager";
import { projectLogger } from "@/lib/project-logger";
import {
  stateRepository,
  workflowRepository,
  transitionRepository,
  imageRepository,
} from "@/lib/repositories";
import {
  createLoadingStateMachine,
  type LoadingStateMachine,
  type LoadingContext,
  type StateListener,
} from "./loading-state-machine";
import { validateProjectId, projectIdsDiffer } from "./project-validator";

/**
 * Project data structure from backend
 */
export interface ProjectData {
  id: string | number;
  name: string;
  /** Server version for optimistic concurrency control */
  version: number;
  configuration: {
    workflows?: unknown[];
    states?: unknown[];
    transitions?: unknown[];
    images?: unknown[];
    categories?: string[];
    settings?: unknown;
  } | null;
}

/**
 * Project loader configuration
 */
export interface ProjectLoaderConfig {
  /** Whether to save current project before loading new one */
  saveBeforeLoad: boolean;
  /** Maximum retries on error */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
}

const DEFAULT_CONFIG: ProjectLoaderConfig = {
  saveBeforeLoad: true,
  maxRetries: 2,
  retryDelay: 1000,
};

/**
 * Project Loader Service
 */
class ProjectLoaderService {
  private stateMachine: LoadingStateMachine;
  private config: ProjectLoaderConfig;
  private loadedProjectId: string | null = null;

  constructor(config: Partial<ProjectLoaderConfig> = {}) {
    this.stateMachine = createLoadingStateMachine();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current loading context
   */
  getContext(): LoadingContext {
    return this.stateMachine.getContext();
  }

  /**
   * Get the ID of the currently loaded project
   */
  getLoadedProjectId(): string | null {
    return this.loadedProjectId;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener): () => void {
    return this.stateMachine.subscribe(listener);
  }

  /**
   * Check if currently loading
   */
  isLoading(): boolean {
    return this.stateMachine.isLoading();
  }

  /**
   * Check if a project is already loaded
   */
  isProjectLoaded(projectId: string): boolean {
    return this.loadedProjectId === projectId && this.stateMachine.isLoaded();
  }

  /**
   * Load a project by ID
   */
  async load(
    projectId: string,
    options: { force?: boolean; currentProjectId?: string | null } = {}
  ): Promise<boolean> {
    const { force = false, currentProjectId = null } = options;

    // Validate project ID
    const validation = validateProjectId(projectId);
    if (!validation.isValid) {
      projectLogger.warn("ProjectLoader", "Invalid project ID", {
        projectId,
        error: validation.error,
      });
      return false;
    }

    const normalizedId = validation.projectId!;

    // Skip if already loaded (unless forced)
    if (!force && this.isProjectLoaded(normalizedId)) {
      projectLogger.debug("ProjectLoader", "Project already loaded", {
        projectId: normalizedId,
      });
      return true;
    }

    // Skip if already loading
    if (this.isLoading()) {
      projectLogger.warn("ProjectLoader", "Load already in progress", {
        projectId: normalizedId,
        currentState: this.getContext().state,
      });
      return false;
    }

    projectLogger.projectLoader("Starting project load", {
      projectId: normalizedId,
      force,
      currentProjectId,
    });

    // Start state machine
    this.stateMachine.send({ type: "LOAD", projectId: normalizedId });

    try {
      // Validation phase
      this.stateMachine.send({
        type: "VALIDATED",
        projectId: normalizedId,
        previousProjectId: currentProjectId,
      });

      // Save current project if needed
      // When force=true, skip saving because we want backend data to take precedence
      // (e.g., after importing states from Web Extraction, the backend has the imported states
      // and we don't want to overwrite them with the old Zustand store data)
      if (
        !force &&
        this.config.saveBeforeLoad &&
        projectIdsDiffer(currentProjectId, normalizedId)
      ) {
        await this.saveCurrentProject(currentProjectId);
      } else {
        this.stateMachine.send({ type: "SKIP_SAVE" });
      }

      // Flush pending debounced saves before fetching from backend.
      // IMPORTANT: Skip this when force=true - we want backend data to take precedence
      // (e.g., after importing states, backend has the imported states and we don't
      // want to overwrite them with the old local data)
      if (!force) {
        projectLogger.projectLoader("Flushing pending saves before fetch", {
          projectId: normalizedId,
        });
        await debounceManager.flushAll();
        await syncCoordinator.saveNow();
      } else {
        projectLogger.projectLoader(
          "Skipping flush/save before fetch (force=true, backend data takes precedence)",
          { projectId: normalizedId }
        );
        // Cancel any pending debounced saves to prevent race conditions
        debounceManager.cancelAll();
        // Cancel pending changes in the new ChangeTracker
        syncCoordinator.getChangeTracker().cancel();
        // CRITICAL: Transition to reloading state to block saves
        // This prevents the event-driven sync from saving old data
        syncCoordinator.setLoadingFromBackend(true);
        useAutomationStore.getState().setIsLoadingFromBackend(true);
      }

      // Fetch from backend
      const projectData = await this.fetchProject(normalizedId);
      this.stateMachine.send({ type: "FETCHED", projectData });

      // Hydrate store
      // When force=true (e.g., after importing states), prefer backend data over IndexedDB
      await this.hydrateStore(projectData, { preferBackend: force });
      this.stateMachine.send({ type: "HYDRATED" });

      // Mark as loaded
      this.loadedProjectId = normalizedId;

      projectLogger.projectLoader("Project load completed", {
        projectId: normalizedId,
        projectName: projectData.name,
      });

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      projectLogger.error("ProjectLoader", "Project load failed", {
        projectId: normalizedId,
        error: errorMessage,
      });

      // Reset loading flag if we set it earlier (when force=true)
      if (force) {
        syncCoordinator.setLoadingFromBackend(false);
        useAutomationStore.getState().setIsLoadingFromBackend(false);
      }

      this.stateMachine.send({ type: "ERROR", error: errorMessage });

      // Retry if configured
      const context = this.getContext();
      if (context.retryCount < this.config.maxRetries) {
        projectLogger.info("ProjectLoader", "Retrying load", {
          attempt: context.retryCount + 1,
          maxRetries: this.config.maxRetries,
        });
        await this.delay(this.config.retryDelay);
        this.stateMachine.send({ type: "RETRY" });
        return this.load(normalizedId, { force: true, currentProjectId });
      }

      return false;
    }
  }

  /**
   * Save current project before loading new one
   */
  private async saveCurrentProject(
    currentProjectId: string | null
  ): Promise<void> {
    if (!currentProjectId) {
      this.stateMachine.send({ type: "SKIP_SAVE" });
      return;
    }

    projectLogger.projectLoader("Saving current project before load", {
      projectId: currentProjectId,
    });

    try {
      const store = useAutomationStore.getState();
      const config = store.getConfiguration();

      const hasData =
        ((config.workflows as unknown[])?.length ?? 0) > 0 ||
        ((config.states as unknown[])?.length ?? 0) > 0 ||
        ((config.transitions as unknown[])?.length ?? 0) > 0 ||
        ((config.images as unknown[])?.length ?? 0) > 0;

      if (hasData) {
        await projectService.updateProject(currentProjectId, {
          configuration: config,
        });
        projectLogger.projectLoader("Current project saved", {
          projectId: currentProjectId,
        });
      } else {
        projectLogger.projectLoader("Skipping save - config empty", {
          projectId: currentProjectId,
        });
      }

      this.stateMachine.send({ type: "CURRENT_SAVED" });
    } catch (error) {
      // Log but don't fail - saving current is best effort
      projectLogger.error("ProjectLoader", "Failed to save current project", {
        projectId: currentProjectId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      this.stateMachine.send({ type: "SKIP_SAVE" });
    }
  }

  /**
   * Fetch project from backend
   */
  private async fetchProject(projectId: string): Promise<ProjectData> {
    projectLogger.projectLoader("Fetching project from backend", { projectId });

    const project = await projectService.getProject(projectId);

    projectLogger.projectLoader("Project fetched", {
      projectId: project.id,
      projectName: project.name,
      version: project.version,
      hasConfiguration: !!project.configuration,
    });

    return {
      id: project.id,
      name: project.name,
      version: project.version,
      configuration: project.configuration as ProjectData["configuration"],
    };
  }

  /**
   * Hydrate the Zustand store with project data
   *
   * IMPORTANT: This function prefers IndexedDB data when it exists, UNLESS
   * preferBackend is true (e.g., after importing states from Web Extraction).
   * This prevents data loss when local changes haven't been synced to backend yet.
   * The flow is:
   * 1. If preferBackend is true, use backend data and update IndexedDB
   * 2. Otherwise, check if IndexedDB has data for this project
   * 3. If yes, use IndexedDB data (it has the latest local changes)
   * 4. If no, use backend data (first time loading this project in this browser)
   *
   * SYNC INTEGRATION:
   * - Updates the version tracker with the server version after loading
   * - This enables optimistic concurrency control for subsequent saves
   */
  private async hydrateStore(
    projectData: ProjectData,
    options: { preferBackend?: boolean } = {}
  ): Promise<void> {
    const { preferBackend = false } = options;

    projectLogger.projectLoader("Hydrating store", {
      projectId: projectData.id,
      projectName: projectData.name,
      version: projectData.version,
      preferBackend,
    });

    const store = useAutomationStore.getState();
    const backendConfig = projectData.configuration || {};

    // Set loading flag to prevent auto-save during hydration
    store.setIsLoadingFromBackend(true);
    syncCoordinator.setLoadingFromBackend(true);

    try {
      // If preferBackend is true, skip IndexedDB check and use backend data directly
      // This is used after operations like importing states where backend has newer data
      if (preferBackend) {
        projectLogger.projectLoader("Using backend data (preferBackend=true)", {
          projectId: projectData.id,
          backendStates: (backendConfig.states as unknown[])?.length ?? 0,
          backendWorkflows: (backendConfig.workflows as unknown[])?.length ?? 0,
        });

        // Clear existing IndexedDB data for this project to avoid stale data
        await Promise.all([
          stateRepository.deleteByProject(projectData.name),
          workflowRepository.deleteByProject(projectData.name),
          transitionRepository.deleteByProject(projectData.name),
          imageRepository.deleteByProject(projectData.name),
        ]);

        await store.loadConfiguration({
          name: projectData.name,
          workflows: backendConfig.workflows,
          states: backendConfig.states,
          transitions: backendConfig.transitions,
          images: backendConfig.images,
          categories: backendConfig.categories,
          settings: backendConfig.settings,
        });

        // Save backend data to IndexedDB for future local persistence
        await this.saveToIndexedDB(projectData.name, backendConfig);

        // Update project metadata
        store.setProjectName(projectData.name);
        store.setProjectId(String(projectData.id));

        // Update version tracker with server version
        syncCoordinator.updateServerVersion(projectData.version, true);

        projectLogger.projectLoader("Store hydrated from backend", {
          projectId: projectData.id,
          version: projectData.version,
        });
        return;
      }

      // Check if IndexedDB has data for this project
      // If it does, prefer it over backend data to preserve local changes
      const [localStates, localWorkflows, localTransitions, localImages] =
        await Promise.all([
          stateRepository.getByProject(projectData.name),
          workflowRepository.getByProject(projectData.name),
          transitionRepository.getByProject(projectData.name),
          imageRepository.getByProject(projectData.name),
        ]);

      const hasLocalData =
        localStates.length > 0 ||
        localWorkflows.length > 0 ||
        localTransitions.length > 0 ||
        localImages.length > 0;

      if (hasLocalData) {
        // Use IndexedDB data - it has the latest local changes
        projectLogger.projectLoader(
          "Using IndexedDB data (has local changes)",
          {
            projectId: projectData.id,
            localStates: localStates.length,
            localWorkflows: localWorkflows.length,
            localTransitions: localTransitions.length,
            localImages: localImages.length,
          }
        );

        await store.loadConfiguration({
          name: projectData.name,
          workflows: localWorkflows,
          states: localStates,
          transitions: localTransitions,
          images: localImages,
          categories: backendConfig.categories,
          settings: backendConfig.settings,
        });
      } else {
        // No local data - use backend data and save to IndexedDB
        projectLogger.projectLoader("Using backend data (no local data)", {
          projectId: projectData.id,
          backendStates: (backendConfig.states as unknown[])?.length ?? 0,
          backendWorkflows: (backendConfig.workflows as unknown[])?.length ?? 0,
        });

        await store.loadConfiguration({
          name: projectData.name,
          workflows: backendConfig.workflows,
          states: backendConfig.states,
          transitions: backendConfig.transitions,
          images: backendConfig.images,
          categories: backendConfig.categories,
          settings: backendConfig.settings,
        });

        // Save backend data to IndexedDB for future local persistence
        const projectName = projectData.name;
        const states = (backendConfig.states as unknown[]) ?? [];
        const workflows = (backendConfig.workflows as unknown[]) ?? [];
        const transitions = (backendConfig.transitions as unknown[]) ?? [];
        const images = (backendConfig.images as unknown[]) ?? [];

        for (const state of states) {
          await stateRepository.save({
            ...(state as Record<string, unknown>),
            projectName,
          } as Parameters<typeof stateRepository.save>[0]);
        }
        for (const workflow of workflows) {
          await workflowRepository.save({
            ...(workflow as Record<string, unknown>),
            projectName,
          } as Parameters<typeof workflowRepository.save>[0]);
        }
        for (const transition of transitions) {
          await transitionRepository.save({
            ...(transition as Record<string, unknown>),
            projectName,
          } as Parameters<typeof transitionRepository.save>[0]);
        }
        for (const image of images) {
          await imageRepository.save({
            ...(image as Record<string, unknown>),
            projectName,
          } as Parameters<typeof imageRepository.save>[0]);
        }

        projectLogger.projectLoader("Backend data saved to IndexedDB", {
          projectId: projectData.id,
          statesSaved: states.length,
          workflowsSaved: workflows.length,
        });
      }

      // Update project metadata
      store.setProjectName(projectData.name);
      store.setProjectId(String(projectData.id));

      // Update version tracker with server version
      // This enables optimistic concurrency control for saves
      syncCoordinator.updateServerVersion(projectData.version, true);

      projectLogger.projectLoader("Store hydrated", {
        projectId: projectData.id,
        version: projectData.version,
        source: hasLocalData ? "IndexedDB" : "backend",
      });
    } finally {
      // Clear loading flag after a brief delay to ensure state updates complete
      setTimeout(() => {
        store.setIsLoadingFromBackend(false);
        syncCoordinator.setLoadingFromBackend(false);
      }, 100);
    }
  }

  /**
   * Save configuration data to IndexedDB
   */
  private async saveToIndexedDB(
    projectName: string,
    config: ProjectData["configuration"]
  ): Promise<void> {
    const states = (config?.states as unknown[]) ?? [];
    const workflows = (config?.workflows as unknown[]) ?? [];
    const transitions = (config?.transitions as unknown[]) ?? [];
    const images = (config?.images as unknown[]) ?? [];

    for (const state of states) {
      await stateRepository.save({
        ...(state as Record<string, unknown>),
        projectName,
      } as Parameters<typeof stateRepository.save>[0]);
    }
    for (const workflow of workflows) {
      await workflowRepository.save({
        ...(workflow as Record<string, unknown>),
        projectName,
      } as Parameters<typeof workflowRepository.save>[0]);
    }
    for (const transition of transitions) {
      await transitionRepository.save({
        ...(transition as Record<string, unknown>),
        projectName,
      } as Parameters<typeof transitionRepository.save>[0]);
    }
    for (const image of images) {
      await imageRepository.save({
        ...(image as Record<string, unknown>),
        projectName,
      } as Parameters<typeof imageRepository.save>[0]);
    }

    projectLogger.projectLoader("Data saved to IndexedDB", {
      projectName,
      statesSaved: states.length,
      workflowsSaved: workflows.length,
      transitionsSaved: transitions.length,
      imagesSaved: images.length,
    });
  }

  /**
   * Reset the loader state
   */
  reset(): void {
    this.stateMachine.send({ type: "RESET" });
    this.loadedProjectId = null;
  }

  /**
   * Force reload current project
   */
  async reload(): Promise<boolean> {
    const currentId = this.loadedProjectId;
    if (!currentId) {
      projectLogger.warn("ProjectLoader", "No project to reload");
      return false;
    }

    this.loadedProjectId = null;
    return this.load(currentId, { force: true });
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let loaderInstance: ProjectLoaderService | null = null;

/**
 * Get the project loader service instance
 */
export function getProjectLoader(): ProjectLoaderService {
  if (!loaderInstance) {
    loaderInstance = new ProjectLoaderService();
  }
  return loaderInstance;
}

/**
 * Create a new project loader instance (for testing)
 */
export function createProjectLoader(
  config?: Partial<ProjectLoaderConfig>
): ProjectLoaderService {
  return new ProjectLoaderService(config);
}

export type { ProjectLoaderService };
