/**
 * Search Engine
 *
 * Handles state search and filtering logic including
 * advanced filters, image usage, and action type filtering.
 */

import type {
  State,
  OutgoingTransition,
} from "@/contexts/automation-context/types";

import type {
  StateMetadata,
  StateSearchFilter,
  StateSearchResult,
  SearchMatch,
  StateComplexity,
} from "@/types/state-organization/types";

import {
  STATE_COMPLEXITY_THRESHOLDS,
  STATE_COMPLEXITY_WEIGHTS,
} from "@/types/state-organization/types";

import type { ServiceState } from "./types";

export class SearchEngine {
  constructor(private state: ServiceState) {}

  /**
   * Search states with advanced filters
   */
  searchStates(
    query: string,
    filters?: StateSearchFilter
  ): StateSearchResult[] {
    const results: StateSearchResult[] = [];
    const searchTerm = filters?.caseSensitive ? query : query.toLowerCase();

    for (const state of this.state.states) {
      const metadata = this.state.metadata.get(state.id) || { tags: [] };
      const matches: SearchMatch[] = [];
      let score = 0;

      // Apply filters first
      if (!this.matchesFilters(state, metadata, filters)) {
        continue;
      }

      // Search in name
      const stateName = filters?.caseSensitive
        ? state.name
        : state.name.toLowerCase();
      if (stateName.includes(searchTerm)) {
        matches.push({
          field: "name",
          value: state.name,
          matchedText: query,
        });
        score += 50;
      }

      // Search in description
      if (filters?.includeDescription !== false && state.description) {
        const stateDesc = filters?.caseSensitive
          ? state.description
          : state.description.toLowerCase();
        if (stateDesc.includes(searchTerm)) {
          matches.push({
            field: "description",
            value: state.description,
            matchedText: query,
          });
          score += 25;
        }
      }

      // Search in tags
      for (const tag of metadata.tags) {
        const tagValue = filters?.caseSensitive ? tag : tag.toLowerCase();
        if (tagValue.includes(searchTerm)) {
          matches.push({
            field: "tag",
            value: tag,
            matchedText: query,
          });
          score += 30;
        }
      }

      if (matches.length > 0 || !query) {
        results.push({ state, metadata, matches, score });
      }
    }

    // Sort by score (descending)
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Filter states by image usage
   */
  filterByImageUsage(imageId: string): State[] {
    return this.state.states.filter((state) =>
      state.stateImages.some((img) =>
        img.patterns.some((pattern) => pattern.imageId === imageId)
      )
    );
  }

  /**
   * Filter states by action type (via transitions)
   */
  filterByActionType(_actionType: string): State[] {
    // This would require workflow analysis
    // For now, return states with transitions
    const statesWithTransitions = new Set<string>();

    for (const transition of this.state.transitions) {
      if (transition.type === "OutgoingTransition") {
        statesWithTransitions.add(transition.fromState);
      }
      if (transition.toState) {
        statesWithTransitions.add(transition.toState);
      }
    }

    return this.state.states.filter((s) => statesWithTransitions.has(s.id));
  }

  /**
   * Check if state matches filters
   */
  private matchesFilters(
    state: State,
    metadata: StateMetadata,
    filters?: StateSearchFilter
  ): boolean {
    if (!filters) return true;

    // Group filter
    if (filters.groups && filters.groups.length > 0) {
      const association = this.state.associations.find(
        (a) => a.stateId === state.id
      );
      if (!association || !filters.groups.includes(association.groupId)) {
        return false;
      }
    }

    // Tag filter
    if (filters.tags && filters.tags.length > 0) {
      const hasTag = filters.tags.some((tag) => metadata.tags.includes(tag));
      if (!hasTag) return false;
    }

    // Has images filter
    if (filters.hasImages !== undefined) {
      const hasImages = state.stateImages.length > 0;
      if (hasImages !== filters.hasImages) return false;
    }

    // Has transitions filter
    if (filters.hasTransitions !== undefined) {
      const hasTransitions = this.state.transitions.some(
        (t) =>
          (t.type === "OutgoingTransition" &&
            (t as OutgoingTransition).fromState === state.id) ||
          t.toState === state.id
      );
      if (hasTransitions !== filters.hasTransitions) return false;
    }

    // Complexity filter
    if (
      filters.complexityMin !== undefined ||
      filters.complexityMax !== undefined
    ) {
      const complexity = this.computeComplexity(state);
      if (complexity) {
        if (
          filters.complexityMin !== undefined &&
          complexity.complexityScore < filters.complexityMin
        ) {
          return false;
        }
        if (
          filters.complexityMax !== undefined &&
          complexity.complexityScore > filters.complexityMax
        ) {
          return false;
        }
      }
    }

    // Image usage filter
    if (filters.imageId) {
      const usesImage = state.stateImages.some((img) =>
        img.patterns.some((p) => p.imageId === filters.imageId)
      );
      if (!usesImage) return false;
    }

    return true;
  }

  /**
   * Compute complexity for a state (used internally for filter matching).
   * Uses the same algorithm as the Analyzer but avoids circular dependencies.
   */
  private computeComplexity(state: State): StateComplexity {
    const imageCount = state.stateImages.length;
    const regionCount = state.regions.length;
    const locationCount = state.locations.length;

    let transitionCount = 0;
    for (const transition of this.state.transitions) {
      if (
        transition.type === "OutgoingTransition" &&
        (transition as OutgoingTransition).fromState === state.id
      ) {
        transitionCount++;
      }
      if (transition.toState === state.id) {
        transitionCount++;
      }
    }

    const totalPatternCount = state.stateImages.reduce(
      (sum, img) => sum + img.patterns.length,
      0
    );

    const searchRegionCount =
      state.regions.filter((r) => r.isSearchRegion).length +
      state.stateImages.reduce(
        (sum, img) => sum + (img.searchRegions?.length || 0),
        0
      );

    const score = Math.min(
      100,
      imageCount * STATE_COMPLEXITY_WEIGHTS.imageCount +
        regionCount * STATE_COMPLEXITY_WEIGHTS.regionCount +
        locationCount * STATE_COMPLEXITY_WEIGHTS.locationCount +
        transitionCount * STATE_COMPLEXITY_WEIGHTS.transitionCount +
        totalPatternCount * STATE_COMPLEXITY_WEIGHTS.patternCount +
        searchRegionCount * STATE_COMPLEXITY_WEIGHTS.searchRegionCount
    );

    let level: StateComplexity["level"] = "simple";
    if (score >= STATE_COMPLEXITY_THRESHOLDS.complex) {
      level = "very-complex";
    } else if (score >= STATE_COMPLEXITY_THRESHOLDS.moderate) {
      level = "complex";
    } else if (score >= STATE_COMPLEXITY_THRESHOLDS.simple) {
      level = "moderate";
    }

    return {
      imageCount,
      regionCount,
      locationCount,
      transitionCount,
      totalPatternCount,
      searchRegionCount,
      complexityScore: score,
      level,
    };
  }
}
