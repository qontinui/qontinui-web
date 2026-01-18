/**
 * Pathfinding Service
 *
 * Validates reachability of multiple target states using the multistate
 * pathfinding algorithm via the runner.
 */

import { ApiConfig } from "./api-config";
import type {
  State,
  OutgoingTransition,
} from "@/contexts/automation-context/types";

// ============================================================================
// Types
// ============================================================================

export interface PathStep {
  transitionId: string;
  fromStates: string[];
  toStates: string[];
}

export interface PathValidationResult {
  reachable: boolean;
  path: PathStep[] | null;
  reason: string | null;
  details: Record<string, unknown> | null;
}

export interface ReachabilityAnalysis {
  startingStates: string[];
  allStates: string[];
  reachableStates: string[];
  unreachableStates: string[];
  availableTransitions: string[];
  targetAnalysis: Record<
    string,
    {
      status: string;
      reachable: boolean;
      pathLength?: number;
    }
  >;
  complexity: Record<string, unknown>;
}

// ============================================================================
// Service
// ============================================================================

class PathfindingService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = ApiConfig.getRunnerUrl();
  }

  /**
   * Validate if all target states can be reached simultaneously.
   *
   * This uses the multistate pathfinding algorithm to check if there exists
   * a sequence of transitions that results in ALL target states being active.
   *
   * @param states - All state definitions
   * @param transitions - All transition definitions
   * @param targetStateIds - State IDs that must ALL be reached
   * @param fromStateIds - Optional starting state IDs (uses initial states if not provided)
   * @returns Validation result with path if successful
   */
  async validatePath(
    states: State[],
    transitions: OutgoingTransition[],
    targetStateIds: string[],
    fromStateIds?: string[]
  ): Promise<PathValidationResult> {
    // Quick validation - single target is always potentially reachable
    if (targetStateIds.length <= 1) {
      return {
        reachable: true,
        path: null,
        reason: "Single target state - no multi-target validation needed",
        details: null,
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/pathfinding/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          states: states.map((s) => ({
            id: s.id,
            name: s.name,
            isInitial: s.initial ?? false,
            isBlocking: false, // Could be enhanced to detect modal states
          })),
          transitions: transitions.map((t) => ({
            id: t.id,
            fromState: t.fromState,
            activateStates: t.activateStates,
            deactivateStates: t.deactivateStates,
            staysVisible: t.staysVisible,
          })),
          fromStates: fromStateIds ?? [],
          targetStates: targetStateIds,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Pathfinding validation failed:", errorText);
        return {
          reachable: false,
          path: null,
          reason: `API error: ${response.status}`,
          details: { error: errorText },
        };
      }

      const result = await response.json();
      return {
        reachable: result.reachable,
        path: result.path
          ? result.path.map(
              (step: {
                transition_id: string;
                from_states: string[];
                to_states: string[];
              }) => ({
                transitionId: step.transition_id,
                fromStates: step.from_states,
                toStates: step.to_states,
              })
            )
          : null,
        reason: result.reason,
        details: result.details,
      };
    } catch (error) {
      console.error("Pathfinding service error:", error);
      return {
        reachable: false,
        path: null,
        reason:
          error instanceof Error
            ? error.message
            : "Failed to connect to pathfinding service",
        details: null,
      };
    }
  }

  /**
   * Analyze reachability of states from a starting position.
   *
   * This provides detailed information about which states are reachable
   * and the structure of the state graph.
   *
   * @param states - All state definitions
   * @param transitions - All transition definitions
   * @param targetStateIds - Target states to analyze
   * @param fromStateIds - Optional starting state IDs
   * @returns Detailed reachability analysis
   */
  async analyzeReachability(
    states: State[],
    transitions: OutgoingTransition[],
    targetStateIds: string[],
    fromStateIds?: string[]
  ): Promise<ReachabilityAnalysis | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/pathfinding/analyze-reachability`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            states: states.map((s) => ({
              id: s.id,
              name: s.name,
              isInitial: s.initial ?? false,
              isBlocking: false,
            })),
            transitions: transitions.map((t) => ({
              id: t.id,
              fromState: t.fromState,
              activateStates: t.activateStates,
              deactivateStates: t.deactivateStates,
              staysVisible: t.staysVisible,
            })),
            fromStates: fromStateIds ?? [],
            targetStates: targetStateIds,
          }),
        }
      );

      if (!response.ok) {
        console.error("Reachability analysis failed:", response.status);
        return null;
      }

      const result = await response.json();
      return {
        startingStates: result.starting_states,
        allStates: result.all_states,
        reachableStates: result.reachable_states,
        unreachableStates: result.unreachable_states,
        availableTransitions: result.available_transitions,
        targetAnalysis: result.target_analysis,
        complexity: result.complexity,
      };
    } catch (error) {
      console.error("Reachability analysis error:", error);
      return null;
    }
  }

  /**
   * Check if runner pathfinding service is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const pathfindingService = new PathfindingService();
