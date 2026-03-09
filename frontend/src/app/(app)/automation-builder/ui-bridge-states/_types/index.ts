/**
 * Types for UI Bridge State Machine page.
 *
 * Re-exports from @qontinui/shared-types.
 */

// Re-export all state machine types from shared package
export type {
  StandardActionType,
  TransitionAction,
  StateMachineTransition,
  StateMachineTransitionCreate,
  StateMachineTransitionUpdate,
  StateMachineState,
  StateMachineConfigFull,
  PathfindingRequest,
  PathfindingStep,
  PathfindingResult,
  StateMachineExportFormat,
  StateNodeData,
  TransitionEdgeData,
  DomainKnowledge,
  DiscoveryStrategy,
} from "@qontinui/shared-types";

// Web-specific: config with project_id (extends shared type)
import type { StateMachineConfigFull } from "@qontinui/shared-types";

export interface ConfigWithStatesAndTransitions extends StateMachineConfigFull {
  project_id: string;
}
