/**
 * State Builder Utilities
 *
 * Helper functions for state analysis, validation, and organization
 */

import type { State, Transition } from "@/contexts/automation-context";
import type {
  StateWithMetadata,
  StateValidationIssue,
  StateUsageInfo,
  StateAnalytics,
  StateComparison,
  ComplexityLevel,
} from "./types";
import type { Workflow } from "@/lib/action-schema/action-types";

// ============================================================================
// Complexity Analysis
// ============================================================================

/**
 * Calculate state complexity score
 */
export function calculateStateComplexity(state: State): number {
  let score = 0;

  // StateImages contribute most to complexity
  score += (state.stateImages?.length || 0) * 2;

  // Count total patterns across all StateImages
  state.stateImages?.forEach((si) => {
    score += (si.patterns?.length || 0) * 1.5;
    // SearchRegions add complexity
    score += (si.searchRegions?.length || 0) * 0.5;
  });

  // Regions, locations, and strings
  score += (state.regions?.length || 0) * 1;
  score += (state.locations?.length || 0) * 1;
  score += (state.strings?.length || 0) * 0.5;

  // Relative positioning adds complexity
  const hasRelativePositioning =
    state.regions?.some((r) => r.referenceImageId) ||
    state.locations?.some((l) => l.referenceImageId);
  if (hasRelativePositioning) {
    score += 2;
  }

  return Math.round(score);
}

/**
 * Get complexity level from score
 */
export function getComplexityLevel(score: number): ComplexityLevel {
  if (score < 5) return "low";
  if (score < 15) return "medium";
  if (score < 30) return "high";
  return "very-high";
}

/**
 * Get complexity color class
 */
export function getComplexityColor(level: ComplexityLevel): string {
  switch (level) {
    case "low":
      return "text-green-500 border-green-500";
    case "medium":
      return "text-yellow-500 border-yellow-500";
    case "high":
      return "text-orange-500 border-orange-500";
    case "very-high":
      return "text-red-500 border-red-500";
  }
}

// ============================================================================
// State Validation
// ============================================================================

/**
 * Validate state for common issues
 */
export function validateState(state: State): StateValidationIssue[] {
  const issues: StateValidationIssue[] = [];

  // Check for empty name
  if (!state.name || state.name.trim() === "") {
    issues.push({
      type: "error",
      code: "EMPTY_NAME",
      message: "State name is empty",
      suggestion: "Provide a descriptive name for the state",
    });
  }

  // Check for very long names
  if (state.name && state.name.length > 100) {
    issues.push({
      type: "warning",
      code: "LONG_NAME",
      message: "State name is very long (> 100 characters)",
      suggestion: "Consider using a shorter, more concise name",
    });
  }

  // Check for states with no StateImages
  if (!state.stateImages || state.stateImages.length === 0) {
    issues.push({
      type: "warning",
      code: "NO_IMAGES",
      message: "State has no StateImages",
      suggestion: "Add at least one StateImage for state detection",
    });
  }

  // Check for StateImages without patterns
  state.stateImages?.forEach((si) => {
    if (!si.patterns || si.patterns.length === 0) {
      issues.push({
        type: "error",
        code: "NO_PATTERNS",
        message: `StateImage "${si.name}" has no patterns`,
        element: {
          type: "stateImage",
          id: si.id,
          name: si.name,
        },
        suggestion: "Add at least one pattern with an image",
      });
    }
  });

  // Check for patterns without images
  state.stateImages?.forEach((si) => {
    si.patterns?.forEach((pattern, idx) => {
      if (!pattern.imageId) {
        issues.push({
          type: "error",
          code: "PATTERN_NO_IMAGE",
          message: `Pattern ${idx + 1} in StateImage "${si.name}" has no image`,
          element: {
            type: "stateImage",
            id: si.id,
            name: si.name,
          },
          suggestion: "Assign an image to this pattern",
        });
      }
    });
  });

  // Check for regions with zero dimensions
  state.regions?.forEach((region) => {
    if (region.width === 0 || region.height === 0) {
      issues.push({
        type: "error",
        code: "INVALID_REGION_SIZE",
        message: `Region "${region.name}" has zero width or height`,
        element: {
          type: "region",
          id: region.id,
          name: region.name,
        },
        suggestion: "Set valid dimensions for the region",
      });
    }
  });

  // Check for overly complex states
  const complexity = calculateStateComplexity(state);
  if (complexity > 50) {
    issues.push({
      type: "info",
      code: "HIGH_COMPLEXITY",
      message: `State has very high complexity (${complexity})`,
      suggestion: "Consider breaking this state into multiple simpler states",
    });
  }

  // Check for duplicate element names
  const checkDuplicateNames = (
    items: Array<{ id: string; name: string }> | undefined,
    type: string
  ) => {
    if (!items) return;
    const names = new Map<string, number>();
    items.forEach((item) => {
      names.set(item.name, (names.get(item.name) || 0) + 1);
    });
    names.forEach((count, name) => {
      if (count > 1) {
        issues.push({
          type: "warning",
          code: "DUPLICATE_NAME",
          message: `Multiple ${type}s have the name "${name}"`,
          suggestion: "Use unique names for better clarity",
        });
      }
    });
  };

  checkDuplicateNames(state.stateImages, "StateImage");
  checkDuplicateNames(state.regions, "region");
  checkDuplicateNames(state.locations, "location");
  checkDuplicateNames(state.strings, "string");

  return issues;
}

// ============================================================================
// State Usage Analysis
// ============================================================================

/**
 * Analyze state usage across workflows and transitions
 */
export function analyzeStateUsage(
  state: State,
  workflows: Workflow[],
  transitions: Transition[]
): StateUsageInfo {
  // Find workflows that reference this state (in FIND actions or RUN_WORKFLOW)
  const referencingWorkflows = workflows.filter((workflow) => {
    return workflow.actions.some((action) => {
      // Check FIND actions that target this state's images
      if (
        action.type === "FIND" &&
        action.config &&
        "target" in action.config
      ) {
        const findConfig = action.config as unknown;
        if (findConfig.target?.type === "state") {
          return findConfig.target.stateId === state.id;
        }
      }
      return false;
    });
  });

  // Find transitions
  const incomingTransitions = transitions.filter(
    (t) => t.type === "IncomingTransition" && t.toState === state.id
  );
  const outgoingTransitions = transitions.filter(
    (t) => t.type === "OutgoingTransition" && t.fromState === state.id
  );

  const allTransitions = [
    ...incomingTransitions.map((t) => ({
      id: t.id,
      type: "incoming" as const,
    })),
    ...outgoingTransitions.map((t) => ({
      id: t.id,
      type: "outgoing" as const,
    })),
  ];

  return {
    workflows: referencingWorkflows.map((w) => ({
      id: w.id,
      name: w.name || w.id,
      category: w.category,
    })),
    transitions: allTransitions,
    totalUsageCount: referencingWorkflows.length + allTransitions.length,
  };
}

// ============================================================================
// State Analytics
// ============================================================================

/**
 * Generate analytics for a state
 */
export function generateStateAnalytics(
  state: State,
  workflows: Workflow[],
  transitions: Transition[]
): StateAnalytics {
  const complexity = calculateStateComplexity(state);
  const validationIssues = validateState(state);
  const usage = analyzeStateUsage(state, workflows, transitions);

  // Count total patterns
  const totalPatterns =
    state.stateImages?.reduce(
      (sum, si) => sum + (si.patterns?.length || 0),
      0
    ) || 0;

  // Count total search regions
  const totalSearchRegions =
    state.stateImages?.reduce(
      (sum, si) => sum + (si.searchRegions?.length || 0),
      0
    ) || 0;

  return {
    stateId: state.id,
    complexity,
    totalPatterns,
    totalSearchRegions,
    hasIssues: validationIssues.length > 0,
    issueCount: {
      errors: validationIssues.filter((i) => i.type === "error").length,
      warnings: validationIssues.filter((i) => i.type === "warning").length,
      info: validationIssues.filter((i) => i.type === "info").length,
    },
    usageCount: usage.totalUsageCount,
    lastModified: (state as StateWithMetadata).modifiedAt,
  };
}

// ============================================================================
// State Comparison
// ============================================================================

/**
 * Compare two states and find differences
 */
export function compareStates(state1: State, state2: State): StateComparison {
  const differences: StateComparison["differences"] = {};

  // Compare StateImages
  const images1 = new Set(state1.stateImages?.map((si) => si.id) || []);
  const images2 = new Set(state2.stateImages?.map((si) => si.id) || []);

  differences.images = {
    only1: Array.from(images1).filter((id) => !images2.has(id)),
    only2: Array.from(images2).filter((id) => !images1.has(id)),
    different: [],
  };

  // Compare regions
  const regions1 = new Set(state1.regions?.map((r) => r.id) || []);
  const regions2 = new Set(state2.regions?.map((r) => r.id) || []);

  differences.regions = {
    only1: Array.from(regions1).filter((id) => !regions2.has(id)),
    only2: Array.from(regions2).filter((id) => !regions1.has(id)),
    different: [],
  };

  // Compare locations
  const locations1 = new Set(state1.locations?.map((l) => l.id) || []);
  const locations2 = new Set(state2.locations?.map((l) => l.id) || []);

  differences.locations = {
    only1: Array.from(locations1).filter((id) => !locations2.has(id)),
    only2: Array.from(locations2).filter((id) => !locations1.has(id)),
    different: [],
  };

  // Compare strings
  const strings1 = new Set(state1.strings?.map((s) => s.id) || []);
  const strings2 = new Set(state2.strings?.map((s) => s.id) || []);

  differences.strings = {
    only1: Array.from(strings1).filter((id) => !strings2.has(id)),
    only2: Array.from(strings2).filter((id) => !strings1.has(id)),
    different: [],
  };

  // Calculate similarity score (0-1)
  const totalElements1 =
    (state1.stateImages?.length || 0) +
    (state1.regions?.length || 0) +
    (state1.locations?.length || 0) +
    (state1.strings?.length || 0);

  const totalElements2 =
    (state2.stateImages?.length || 0) +
    (state2.regions?.length || 0) +
    (state2.locations?.length || 0) +
    (state2.strings?.length || 0);

  const commonElements =
    (differences.images?.only1.length || 0) +
    (differences.images?.only2.length || 0) +
    (differences.regions?.only1.length || 0) +
    (differences.regions?.only2.length || 0) +
    (differences.locations?.only1.length || 0) +
    (differences.locations?.only2.length || 0) +
    (differences.strings?.only1.length || 0) +
    (differences.strings?.only2.length || 0);

  const maxElements = Math.max(totalElements1, totalElements2);
  const similarity = maxElements > 0 ? 1 - commonElements / maxElements : 1;

  return {
    stateId1: state1.id,
    stateId2: state2.id,
    similarity,
    differences,
  };
}

// ============================================================================
// State Similarity
// ============================================================================

/**
 * Find similar states based on structure
 */
export function findSimilarStates(
  targetState: State,
  allStates: State[],
  minSimilarity: number = 0.5
): Array<{ state: State; similarity: number }> {
  return allStates
    .filter((s) => s.id !== targetState.id)
    .map((state) => {
      const comparison = compareStates(targetState, state);
      return {
        state,
        similarity: comparison.similarity,
      };
    })
    .filter((result) => result.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity);
}

// ============================================================================
// State Export
// ============================================================================

/**
 * Export states to JSON
 */
export function exportStatesToJSON(states: State[]): string {
  return JSON.stringify(
    {
      exportDate: new Date().toISOString(),
      version: "1.0.0",
      stateCount: states.length,
      states,
    },
    null,
    2
  );
}

/**
 * Export states to YAML (simplified - would need yaml library for full support)
 */
export function exportStatesToYAML(states: State[]): string {
  // This is a simplified version - in production, use a YAML library
  let yaml = `# State Export\n`;
  yaml += `exportDate: ${new Date().toISOString()}\n`;
  yaml += `version: 1.0.0\n`;
  yaml += `stateCount: ${states.length}\n`;
  yaml += `states:\n`;

  states.forEach((state) => {
    yaml += `  - id: ${state.id}\n`;
    yaml += `    name: "${state.name}"\n`;
    yaml += `    description: "${state.description || ""}"\n`;
    yaml += `    initial: ${state.initial || false}\n`;
    yaml += `    stateImages: ${state.stateImages?.length || 0}\n`;
    yaml += `    regions: ${state.regions?.length || 0}\n`;
    yaml += `    locations: ${state.locations?.length || 0}\n`;
    yaml += `    strings: ${state.strings?.length || 0}\n`;
  });

  return yaml;
}

// ============================================================================
// State Statistics
// ============================================================================

/**
 * Generate statistics for a collection of states
 */
export function generateStateStatistics(states: State[]) {
  const totalStates = states.length;
  const totalStateImages = states.reduce(
    (sum, s) => sum + (s.stateImages?.length || 0),
    0
  );
  const totalRegions = states.reduce(
    (sum, s) => sum + (s.regions?.length || 0),
    0
  );
  const totalLocations = states.reduce(
    (sum, s) => sum + (s.locations?.length || 0),
    0
  );
  const totalStrings = states.reduce(
    (sum, s) => sum + (s.strings?.length || 0),
    0
  );

  const complexityScores = states.map((s) => calculateStateComplexity(s));
  const avgComplexity =
    complexityScores.reduce((sum, c) => sum + c, 0) / (totalStates || 1);
  const maxComplexity = Math.max(...complexityScores, 0);
  const minComplexity = Math.min(...complexityScores, 0);

  const complexityDistribution = {
    low: complexityScores.filter((c) => getComplexityLevel(c) === "low").length,
    medium: complexityScores.filter((c) => getComplexityLevel(c) === "medium")
      .length,
    high: complexityScores.filter((c) => getComplexityLevel(c) === "high")
      .length,
    veryHigh: complexityScores.filter(
      (c) => getComplexityLevel(c) === "very-high"
    ).length,
  };

  const statesWithImages = states.filter(
    (s) => s.stateImages && s.stateImages.length > 0
  ).length;
  const statesWithRegions = states.filter(
    (s) => s.regions && s.regions.length > 0
  ).length;
  const statesWithLocations = states.filter(
    (s) => s.locations && s.locations.length > 0
  ).length;

  return {
    totalStates,
    totalStateImages,
    totalRegions,
    totalLocations,
    totalStrings,
    avgComplexity: Math.round(avgComplexity * 10) / 10,
    maxComplexity,
    minComplexity,
    complexityDistribution,
    statesWithImages,
    statesWithRegions,
    statesWithLocations,
    avgStateImagesPerState:
      Math.round((totalStateImages / (totalStates || 1)) * 10) / 10,
    avgRegionsPerState:
      Math.round((totalRegions / (totalStates || 1)) * 10) / 10,
    avgLocationsPerState:
      Math.round((totalLocations / (totalStates || 1)) * 10) / 10,
  };
}
