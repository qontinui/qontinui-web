/**
 * Duplicate Detector Module
 *
 * Responsible for detecting duplicate resources:
 * - Duplicate images
 * - Duplicate states
 * - Duplicate workflows
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import type { DuplicateMatch } from "./types";
import { calculateStringSimilarity, formatBytes } from "./utils";

/**
 * Find duplicate images by similarity
 */
export function findDuplicateImages(
  image: ImageAsset,
  allImages: ImageAsset[],
  threshold: number = 0.9
): DuplicateMatch[] {
  const duplicates: DuplicateMatch[] = [];

  allImages.forEach((other) => {
    if (other.id === image.id) return;

    // Exact name match
    if (other.name === image.name) {
      duplicates.push({
        id: other.id,
        name: other.name,
        similarity: 1.0,
        matchType: "exact",
        details: "Exact name match",
      });
      return;
    }

    // Size similarity (within 5%)
    const sizeDiff = Math.abs(other.size - image.size) / image.size;
    if (sizeDiff < 0.05) {
      const similarity = 1 - sizeDiff;
      if (similarity >= threshold) {
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity,
          matchType: "similar",
          details: `Similar size: ${formatBytes(other.size)}`,
        });
      }
    }

    // Name similarity (basic)
    const nameSimilarity = calculateStringSimilarity(image.name, other.name);
    if (nameSimilarity >= threshold) {
      duplicates.push({
        id: other.id,
        name: other.name,
        similarity: nameSimilarity,
        matchType: "potential",
        details: "Similar name",
      });
    }
  });

  return duplicates;
}

/**
 * Find duplicate states
 */
export function findDuplicateStates(
  state: State,
  allStates: State[],
  threshold: number = 0.9
): DuplicateMatch[] {
  const duplicates: DuplicateMatch[] = [];

  allStates.forEach((other) => {
    if (other.id === state.id) return;

    // Exact name match
    if (other.name === state.name) {
      duplicates.push({
        id: other.id,
        name: other.name,
        similarity: 1.0,
        matchType: "exact",
        details: "Exact name match",
      });
      return;
    }

    // Structure similarity
    const imageCountSimilar =
      state.stateImages.length === other.stateImages.length;
    const regionCountSimilar = state.regions.length === other.regions.length;

    if (
      imageCountSimilar &&
      regionCountSimilar &&
      state.stateImages.length > 0
    ) {
      const nameSimilarity = calculateStringSimilarity(state.name, other.name);
      if (nameSimilarity >= threshold) {
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity: nameSimilarity,
          matchType: "potential",
          details: "Similar structure and name",
        });
      }
    }
  });

  return duplicates;
}

/**
 * Find duplicate workflows
 */
export function findDuplicateWorkflows(
  workflow: Workflow,
  allWorkflows: Workflow[]
): DuplicateMatch[] {
  const duplicates: DuplicateMatch[] = [];

  allWorkflows.forEach((other) => {
    if (other.id === workflow.id) return;

    // Exact name match
    if (other.name === workflow.name) {
      duplicates.push({
        id: other.id,
        name: other.name,
        similarity: 1.0,
        matchType: "exact",
        details: "Exact name match",
      });
      return;
    }

    // Structure similarity
    const actionCountSame = other.actions.length === workflow.actions.length;
    if (actionCountSame && workflow.actions.length > 0) {
      // Compare action types
      const workflowTypes = workflow.actions.map((a) => a.type).join(",");
      const otherTypes = other.actions.map((a) => a.type).join(",");

      if (workflowTypes === otherTypes) {
        const nameSimilarity = calculateStringSimilarity(
          workflow.name,
          other.name
        );
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity: nameSimilarity,
          matchType: "potential",
          details: "Identical action sequence",
        });
      }
    }
  });

  return duplicates;
}
