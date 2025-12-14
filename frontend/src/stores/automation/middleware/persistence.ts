/**
 * Persistence Utilities
 *
 * Functions for loading and clearing data from IndexedDB.
 */

import type { AutomationStore, Screenshot } from "../types";
import { projectDB } from "@/lib/project-db";
import { screenshotDB } from "@/lib/screenshot-db";
import { projectLogger } from "@/lib/project-logger";

/**
 * Load data from IndexedDB into the store
 */
export async function hydrateFromIndexedDB(
  projectName: string
): Promise<Partial<AutomationStore>> {
  projectLogger.info("Persistence", "Hydrating from IndexedDB", {
    projectName,
  });

  try {
    const [workflows, states, transitions, images, screenshotsRaw] =
      await Promise.all([
        projectDB.getWorkflowsByProject(projectName),
        projectDB.getStatesByProject(projectName),
        projectDB.getTransitionsByProject(projectName),
        projectDB.getImagesByProject(projectName),
        screenshotDB.getByProject(projectName),
      ]);

    // Map screenshotDB format to store format
    const screenshots: Screenshot[] = screenshotsRaw.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      size: s.size,
      uploadedAt: s.uploadedAt,
      description: s.description,
      tags: s.tags,
      projectName: s.projectName,
    }));

    projectLogger.info("Persistence", "Hydration complete", {
      workflows: workflows.length,
      states: states.length,
      transitions: transitions.length,
      images: images.length,
      screenshots: screenshots.length,
    });

    return {
      workflows,
      states,
      transitions,
      images,
      screenshots,
    };
  } catch (error) {
    projectLogger.error("Persistence", "Hydration failed", { error });
    throw error;
  }
}

/**
 * Clear all data for a project from IndexedDB
 */
export async function clearIndexedDB(projectName: string): Promise<void> {
  projectLogger.info("Persistence", "Clearing IndexedDB", {
    projectName,
  });

  try {
    // Clear project data from projectDB
    await projectDB.clearProjectData(projectName);

    // Clear screenshots for the project
    const screenshots = await screenshotDB.getByProject(projectName);
    await Promise.all(screenshots.map((s) => screenshotDB.delete(s.id)));

    projectLogger.info("Persistence", "IndexedDB cleared");
  } catch (error) {
    projectLogger.error("Persistence", "Failed to clear IndexedDB", {
      error,
    });
    throw error;
  }
}
