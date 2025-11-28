/**
 * Storage Analyzer Module
 *
 * Responsible for analyzing storage usage:
 * - Total storage calculations
 * - Storage breakdown by type
 * - Storage breakdown by folder
 * - Potential savings analysis
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import type { StorageAnalysis } from "./types";
import { analyzeImages } from "./resource-analyzer";
import { findDuplicateImages } from "./duplicate-detector";

/**
 * Get storage usage breakdown
 */
export function getStorageUsage(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): StorageAnalysis {
  // Calculate image storage
  const imageStorage = images.reduce((sum, img) => sum + img.size, 0);

  // Estimate other storage (simplified)
  const workflowStorage = workflows.length * 1024; // ~1KB per workflow
  const stateStorage = states.length * 512; // ~512B per state
  const transitionStorage = transitions.length * 256; // ~256B per transition

  // Storage from localStorage
  const testStorage = estimateLocalStorageSize("workflow-test-");
  const docStorage = estimateLocalStorageSize("workflow-documentation");

  const total =
    imageStorage +
    workflowStorage +
    stateStorage +
    transitionStorage +
    testStorage +
    docStorage;

  // Breakdown by folder
  const byFolder: Record<string, number> = {};
  workflows.forEach((workflow) => {
    const folder = workflow.category || "Uncategorized";
    byFolder[folder] = (byFolder[folder] || 0) + 1024;
  });

  // Calculate potential savings
  const unusedImages = images.filter((img) => {
    const analyses = analyzeImages([img], workflows, states);
    return !analyses[0].isUsed;
  });
  const unusedStorage = unusedImages.reduce((sum, img) => sum + img.size, 0);

  const duplicateStorage = images.reduce((sum, img) => {
    const dups = findDuplicateImages(img, images, 0.95);
    return sum + (dups.length > 0 ? img.size / 2 : 0);
  }, 0);

  const potentialSavings = unusedStorage + duplicateStorage;

  return {
    total,
    byType: {
      images: imageStorage,
      workflows: workflowStorage,
      states: stateStorage,
      transitions: transitionStorage,
      tests: testStorage,
      documentation: docStorage,
      other: 0,
    },
    byFolder,
    potentialSavings,
    unusedStorage,
    duplicateStorage,
  };
}

/**
 * Estimate storage savings from optimizations
 */
export function estimateStorageSavings(
  images: ImageAsset[],
  workflows: Workflow[],
  states: State[]
): number {
  const storage = getStorageUsage(workflows, states, images, []);
  return storage.potentialSavings;
}

/**
 * Get image storage breakdown
 */
export function getImageStorageBreakdown(
  images: ImageAsset[]
): Record<string, number> {
  const breakdown: Record<string, number> = {};

  images.forEach((image) => {
    const category = image.source || "unknown";
    breakdown[category] = (breakdown[category] || 0) + image.size;
  });

  return breakdown;
}

/**
 * Estimate localStorage size for keys
 */
function estimateLocalStorageSize(prefix: string): number {
  let size = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const value = localStorage.getItem(key);
        if (value) {
          size += value.length * 2; // UTF-16 encoding
        }
      }
    }
  } catch (error) {
    // localStorage might not be available
    console.warn("Could not access localStorage:", error);
  }

  return size;
}
