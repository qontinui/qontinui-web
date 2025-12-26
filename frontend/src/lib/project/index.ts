/**
 * Project Module
 *
 * Unified project loading and management.
 *
 * USAGE:
 * ```typescript
 * import { getProjectLoader } from "@/lib/project";
 *
 * const loader = getProjectLoader();
 *
 * // Load a project
 * await loader.load("project-id");
 *
 * // Subscribe to loading state
 * const unsubscribe = loader.subscribe((context) => {
 *   console.log("State:", context.state);
 * });
 *
 * // Check status
 * if (loader.isLoading()) {
 *   console.log("Loading...");
 * }
 * ```
 */

// Project loader
export { getProjectLoader, createProjectLoader } from "./project-loader";
export type {
  ProjectLoaderService,
  ProjectData,
  ProjectLoaderConfig,
} from "./project-loader";

// State machine
export { createLoadingStateMachine } from "./loading-state-machine";
export type {
  LoadingState,
  LoadingContext,
  LoadingEvent,
  StateListener,
  LoadingStateMachine,
} from "./loading-state-machine";

// Validators
export {
  validateProjectId,
  extractProjectIdFromUrl,
  resolveProjectId,
  projectIdsDiffer,
} from "./project-validator";
export type { ValidationResult } from "./project-validator";
