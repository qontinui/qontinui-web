/**
 * Workflow Version Control - Persistence Layer
 *
 * Handles save/load/storage operations for version control data using localStorage.
 */

import type { Branch, Version, Tag } from "./types";
import { createLogger } from "@/lib/logger";
const logger = createLogger("VersionControlPersistence");

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  branches: "workflow-branches",
  versions: "workflow-versions",
  tags: "workflow-version-tags",
  currentBranch: "workflow-current-branch",
} as const;

// ============================================================================
// Persistence Functions
// ============================================================================

/**
 * Load all version control data from localStorage
 */
export function loadData(): {
  branches: Map<string, Branch[]>;
  versions: Map<string, Version[]>;
  tags: Map<string, Tag[]>;
  currentBranch: Map<string, string>;
} {
  const branches = new Map<string, Branch[]>();
  const versions = new Map<string, Version[]>();
  const tags = new Map<string, Tag[]>();
  const currentBranch = new Map<string, string>();

  try {
    const branchesJson = localStorage.getItem(STORAGE_KEYS.branches);
    if (branchesJson) {
      const data = JSON.parse(branchesJson);
      Object.entries(data).forEach(([key, value]) => {
        branches.set(key, value as Branch[]);
      });
    }

    const versionsJson = localStorage.getItem(STORAGE_KEYS.versions);
    if (versionsJson) {
      const data = JSON.parse(versionsJson);
      Object.entries(data).forEach(([key, value]) => {
        versions.set(key, value as Version[]);
      });
    }

    const tagsJson = localStorage.getItem(STORAGE_KEYS.tags);
    if (tagsJson) {
      const data = JSON.parse(tagsJson);
      Object.entries(data).forEach(([key, value]) => {
        tags.set(key, value as Tag[]);
      });
    }

    const currentBranchJson = localStorage.getItem(STORAGE_KEYS.currentBranch);
    if (currentBranchJson) {
      const data = JSON.parse(currentBranchJson);
      Object.entries(data).forEach(([key, value]) => {
        currentBranch.set(key, value as string);
      });
    }
  } catch (error) {
    logger.error("Failed to load version control data:", error);
  }

  return { branches, versions, tags, currentBranch };
}

/**
 * Save all version control data to localStorage
 */
export function saveData(data: {
  branches: Map<string, Branch[]>;
  versions: Map<string, Version[]>;
  tags: Map<string, Tag[]>;
  currentBranch: Map<string, string>;
}): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.branches,
      JSON.stringify(Object.fromEntries(data.branches))
    );
    localStorage.setItem(
      STORAGE_KEYS.versions,
      JSON.stringify(Object.fromEntries(data.versions))
    );
    localStorage.setItem(
      STORAGE_KEYS.tags,
      JSON.stringify(Object.fromEntries(data.tags))
    );
    localStorage.setItem(
      STORAGE_KEYS.currentBranch,
      JSON.stringify(Object.fromEntries(data.currentBranch))
    );
  } catch (error) {
    logger.error("Failed to save version control data:", error);
  }
}

/**
 * Clear all version control data from localStorage
 */
export function clearStorageData(): void {
  localStorage.removeItem(STORAGE_KEYS.branches);
  localStorage.removeItem(STORAGE_KEYS.versions);
  localStorage.removeItem(STORAGE_KEYS.tags);
  localStorage.removeItem(STORAGE_KEYS.currentBranch);
}
