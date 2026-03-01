/**
 * Analyzer
 *
 * Handles state analysis, complexity scoring, relationship mapping,
 * graph generation, duplicate detection, and issue diagnosis.
 */

import type {
  State,
  OutgoingTransition,
} from "@/contexts/automation-context/types";

import {
  STATE_COMPLEXITY_THRESHOLDS,
  STATE_COMPLEXITY_WEIGHTS,
  type AnalysisResult,
  type StateAnalysis,
  type StateComplexity,
  type StateGraph,
  type StateGraphEdge,
  type StateGraphNode,
  type StateImageUsage,
  type StateIssue,
  type StateRelationship,
  type StateSimilarity,
  type TransitionInfo,
} from "@/types/state-organization/types";

import type { ServiceState } from "./types";

export class Analyzer {
  constructor(private state: ServiceState) {}

  // ==========================================================================
  // State Relationships
  // ==========================================================================

  /**
   * Get state relationships (incoming/outgoing transitions)
   */
  getStateRelationships(stateId: string): StateRelationship | null {
    const state = this.state.states.find((s) => s.id === stateId);
    if (!state) return null;

    const incoming: TransitionInfo[] = [];
    const outgoing: TransitionInfo[] = [];
    const activates: string[] = [];
    const deactivates: string[] = [];
    const staysVisibleWith: string[] = [];

    for (const transition of this.state.transitions) {
      if (transition.type === "OutgoingTransition") {
        const outTrans = transition as OutgoingTransition;

        if (outTrans.fromState === stateId) {
          outgoing.push({
            transitionId: transition.id,
            fromStateId: outTrans.fromState,
            fromStateName: this.getStateName(outTrans.fromState),
            toStateId: outTrans.toState,
            toStateName: outTrans.toState
              ? this.getStateName(outTrans.toState)
              : undefined,
            workflowCount: transition.workflows.length,
            timeout: transition.timeout,
            retryCount: transition.retryCount,
          });

          activates.push(...outTrans.activateStates);
          deactivates.push(...outTrans.deactivateStates);
          if (outTrans.staysVisible) {
            staysVisibleWith.push(outTrans.toState || "");
          }
        }
      }

      if (transition.toState === stateId) {
        incoming.push({
          transitionId: transition.id,
          fromStateId:
            transition.type === "OutgoingTransition"
              ? (transition as OutgoingTransition).fromState
              : undefined,
          fromStateName:
            transition.type === "OutgoingTransition"
              ? this.getStateName((transition as OutgoingTransition).fromState)
              : undefined,
          toStateId: transition.toState,
          toStateName: this.getStateName(transition.toState),
          workflowCount: transition.workflows.length,
          timeout: transition.timeout,
          retryCount: transition.retryCount,
        });
      }
    }

    return {
      stateId,
      stateName: state.name,
      incoming,
      outgoing,
      activates: [...new Set(activates)],
      deactivates: [...new Set(deactivates)],
      staysVisibleWith: [...new Set(staysVisibleWith)].filter(Boolean),
    };
  }

  /**
   * Find orphaned states (no transitions)
   */
  findOrphanedStates(): State[] {
    const connectedStates = new Set<string>();

    for (const transition of this.state.transitions) {
      if (transition.type === "OutgoingTransition") {
        connectedStates.add((transition as OutgoingTransition).fromState);
      }
      if (transition.toState) {
        connectedStates.add(transition.toState);
      }
    }

    return this.state.states.filter(
      (s) => !connectedStates.has(s.id) && !s.initial
    );
  }

  /**
   * Find dead-end states (no outgoing transitions)
   */
  findDeadEndStates(): State[] {
    const statesWithOutgoing = new Set<string>();

    for (const transition of this.state.transitions) {
      if (transition.type === "OutgoingTransition") {
        statesWithOutgoing.add((transition as OutgoingTransition).fromState);
      }
    }

    return this.state.states.filter((s) => !statesWithOutgoing.has(s.id));
  }

  /**
   * Get state graph (full graph of state relationships)
   */
  getStateGraph(): StateGraph {
    const nodes: StateGraphNode[] = this.state.states.map((state) => ({
      id: state.id,
      name: state.name,
      type: state.initial ? "initial" : "state",
      metadata: this.state.metadata.get(state.id) || { tags: [] },
    }));

    const edges: StateGraphEdge[] = [];

    for (const transition of this.state.transitions) {
      if (transition.type === "OutgoingTransition" && transition.toState) {
        const outTrans = transition as OutgoingTransition;
        edges.push({
          from: outTrans.fromState,
          to: outTrans.toState!,
          transitionId: transition.id,
          workflowCount: transition.workflows.length,
        });
      }
    }

    return { nodes, edges };
  }

  // ==========================================================================
  // State Complexity Analysis
  // ==========================================================================

  /**
   * Analyze state complexity
   */
  analyzeStateComplexity(stateId: string): StateComplexity | null {
    const state = this.state.states.find((s) => s.id === stateId);
    if (!state) return null;

    const imageCount = state.stateImages.length;
    const regionCount = state.regions.length;
    const locationCount = state.locations.length;

    // Count transitions
    let transitionCount = 0;
    for (const transition of this.state.transitions) {
      if (
        transition.type === "OutgoingTransition" &&
        (transition as OutgoingTransition).fromState === stateId
      ) {
        transitionCount++;
      }
      if (transition.toState === stateId) {
        transitionCount++;
      }
    }

    // Count total patterns
    const totalPatternCount = state.stateImages.reduce(
      (sum, img) => sum + img.patterns.length,
      0
    );

    // Count search regions
    const searchRegionCount =
      state.regions.filter((r) => r.isSearchRegion).length +
      state.stateImages.reduce(
        (sum, img) => sum + (img.searchRegions?.length || 0),
        0
      );

    // Calculate complexity score
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

  /**
   * Get complexity score for a state
   */
  getComplexityScore(stateId: string): number {
    const complexity = this.analyzeStateComplexity(stateId);
    return complexity?.complexityScore || 0;
  }

  /**
   * Find duplicate/similar states
   */
  findDuplicateStates(
    threshold = 0.7
  ): Array<{ state: State; duplicates: StateSimilarity[] }> {
    const results: Array<{ state: State; duplicates: StateSimilarity[] }> = [];

    for (const state of this.state.states) {
      const duplicates: StateSimilarity[] = [];

      for (const otherState of this.state.states) {
        if (state.id === otherState.id) continue;

        const similarity = this.calculateStateSimilarity(state, otherState);
        if (similarity.similarityScore >= threshold * 100) {
          duplicates.push(similarity);
        }
      }

      if (duplicates.length > 0) {
        results.push({ state, duplicates });
      }
    }

    return results;
  }

  /**
   * Get full state analysis
   */
  getStateAnalysis(stateId: string): AnalysisResult {
    try {
      const state = this.state.states.find((s) => s.id === stateId);
      if (!state) {
        return { success: false, error: "State not found" };
      }

      const complexity = this.analyzeStateComplexity(stateId);
      const relationships = this.getStateRelationships(stateId);
      const imageUsage = this.getStateImageUsage(state);
      const duplicateCandidates = this.findSimilarStates(state, 0.5);
      const issues = this.analyzeStateIssues(state, complexity, relationships);

      const analysis: StateAnalysis = {
        stateId,
        stateName: state.name,
        complexity: complexity!,
        relationships: relationships!,
        imageUsage,
        duplicateCandidates,
        issues,
      };

      return { success: true, analysis };
    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze state: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Calculate similarity between two states
   */
  private calculateStateSimilarity(
    state1: State,
    state2: State
  ): StateSimilarity {
    const images1 = new Set(
      state1.stateImages.flatMap((img) => img.patterns.map((p) => p.imageId))
    );
    const images2 = new Set(
      state2.stateImages.flatMap((img) => img.patterns.map((p) => p.imageId))
    );

    const commonImages = Array.from(images1).filter((id) =>
      images2.has(id)
    ).length;
    const totalImages = Math.max(images1.size, images2.size);

    const commonRegions = Math.min(
      state1.regions.length,
      state2.regions.length
    );
    const totalRegions = Math.max(state1.regions.length, state2.regions.length);

    const commonLocations = Math.min(
      state1.locations.length,
      state2.locations.length
    );
    const totalLocations = Math.max(
      state1.locations.length,
      state2.locations.length
    );

    // Weighted similarity score
    const imageScore = totalImages > 0 ? (commonImages / totalImages) * 50 : 0;
    const regionScore =
      totalRegions > 0 ? (commonRegions / totalRegions) * 30 : 0;
    const locationScore =
      totalLocations > 0 ? (commonLocations / totalLocations) * 20 : 0;

    return {
      stateId: state2.id,
      stateName: state2.name,
      similarityScore: imageScore + regionScore + locationScore,
      commonImages,
      commonRegions,
      commonLocations,
    };
  }

  /**
   * Find similar states
   */
  private findSimilarStates(
    state: State,
    threshold: number
  ): StateSimilarity[] {
    const similar: StateSimilarity[] = [];

    for (const otherState of this.state.states) {
      if (state.id === otherState.id) continue;

      const similarity = this.calculateStateSimilarity(state, otherState);
      if (similarity.similarityScore >= threshold * 100) {
        similar.push(similarity);
      }
    }

    return similar.sort((a, b) => b.similarityScore - a.similarityScore);
  }

  /**
   * Get image usage for a state
   */
  private getStateImageUsage(state: State): StateImageUsage[] {
    const usage: StateImageUsage[] = [];

    for (const stateImage of state.stateImages) {
      const imageIds = stateImage.patterns
        .map((p) => p.imageId)
        .filter((id): id is string => id !== undefined);

      for (const imageId of imageIds) {
        // Count how many states use this image
        const usedInStates = this.state.states.filter((s) =>
          s.stateImages.some((img) =>
            img.patterns.some((p) => p.imageId === imageId)
          )
        ).length;

        usage.push({
          imageId,
          imageName: stateImage.name,
          patternCount: stateImage.patterns.length,
          usedInStates,
          sharedImage: stateImage.shared,
        });
      }
    }

    return usage;
  }

  /**
   * Analyze state issues
   */
  private analyzeStateIssues(
    state: State,
    complexity: StateComplexity | null,
    relationships: StateRelationship | null
  ): StateIssue[] {
    const issues: StateIssue[] = [];

    // Check for orphaned state
    if (
      relationships &&
      relationships.incoming.length === 0 &&
      relationships.outgoing.length === 0
    ) {
      issues.push({
        type: "warning",
        category: "orphaned",
        message: "State has no transitions",
        suggestion: "Add transitions to connect this state to your workflow",
      });
    }

    // Check for dead-end state
    if (
      relationships &&
      relationships.outgoing.length === 0 &&
      relationships.incoming.length > 0
    ) {
      issues.push({
        type: "info",
        category: "dead-end",
        message: "State has no outgoing transitions",
        suggestion:
          "Consider adding transitions to other states or mark as final state",
      });
    }

    // Check for no images
    if (state.stateImages.length === 0) {
      issues.push({
        type: "warning",
        category: "no-images",
        message: "State has no images",
        suggestion: "Add state images for visual recognition",
      });
    }

    // Check for high complexity
    if (complexity && complexity.level === "very-complex") {
      issues.push({
        type: "warning",
        category: "high-complexity",
        message: `High complexity state (score: ${complexity.complexityScore})`,
        suggestion: "Consider breaking this state into smaller, simpler states",
      });
    }

    return issues;
  }

  /**
   * Get state name by ID
   */
  private getStateName(stateId: string): string {
    const state = this.state.states.find((s) => s.id === stateId);
    return state?.name || "Unknown";
  }
}
