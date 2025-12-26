/**
 * Repositories
 *
 * Entity-specific IndexedDB access following the Repository pattern.
 * Each repository handles persistence for a single entity type.
 *
 * ARCHITECTURE:
 * - BaseRepository: Generic CRUD operations with connection management
 * - Entity repositories: Type-safe wrappers with entity-specific operations
 * - Singleton instances: Shared connection pool across all repositories
 *
 * USAGE:
 * ```typescript
 * import { workflowRepository, stateRepository } from "@/lib/repositories";
 *
 * // Get all workflows for a project
 * const workflows = await workflowRepository.getByProject("my-project");
 *
 * // Save a state
 * await stateRepository.save(myState);
 * ```
 */

// Base types and interfaces
export type { Entity, Repository } from "./base-repository";
export { BaseRepository } from "./base-repository";

// Entity repositories
export { workflowRepository } from "./workflow-repository";
export type { WorkflowWithProject } from "./workflow-repository";

export { stateRepository } from "./state-repository";
export type { StateWithProject } from "./state-repository";

export { transitionRepository } from "./transition-repository";
export type { TransitionWithProject } from "./transition-repository";

export { imageRepository } from "./image-repository";
export type { ImageWithProject } from "./image-repository";

/**
 * Convenience function to rename a project across all repositories
 */
export async function renameProjectInAllRepositories(
  oldProjectName: string,
  newProjectName: string
): Promise<void> {
  const { workflowRepository } = await import("./workflow-repository");
  const { stateRepository } = await import("./state-repository");
  const { transitionRepository } = await import("./transition-repository");
  const { imageRepository } = await import("./image-repository");

  await Promise.all([
    workflowRepository.renameProject(oldProjectName, newProjectName),
    stateRepository.renameProject(oldProjectName, newProjectName),
    transitionRepository.renameProject(oldProjectName, newProjectName),
    imageRepository.renameProject(oldProjectName, newProjectName),
  ]);
}

/**
 * Convenience function to delete all data for a project
 */
export async function deleteProjectFromAllRepositories(
  projectName: string
): Promise<void> {
  const { workflowRepository } = await import("./workflow-repository");
  const { stateRepository } = await import("./state-repository");
  const { transitionRepository } = await import("./transition-repository");
  const { imageRepository } = await import("./image-repository");

  await Promise.all([
    workflowRepository.deleteByProject(projectName),
    stateRepository.deleteByProject(projectName),
    transitionRepository.deleteByProject(projectName),
    imageRepository.deleteByProject(projectName),
  ]);
}

/**
 * Convenience function to clear all repositories (for testing/reset)
 */
export async function clearAllRepositories(): Promise<void> {
  const { workflowRepository } = await import("./workflow-repository");
  const { stateRepository } = await import("./state-repository");
  const { transitionRepository } = await import("./transition-repository");
  const { imageRepository } = await import("./image-repository");

  await Promise.all([
    workflowRepository.clear(),
    stateRepository.clear(),
    transitionRepository.clear(),
    imageRepository.clear(),
  ]);
}
