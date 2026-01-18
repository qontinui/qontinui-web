/**
 * Integration Testing Framework Types
 *
 * Type definitions for action snapshots and integration testing.
 */

/**
 * Match region from pattern matching or visual detection
 */
export interface MatchRegion {
  region: { x: number; y: number; width: number; height: number };
  score: number;
  stateImageId?: string;
}

/**
 * Action configuration for different action types
 */
export interface ActionConfig {
  similarity?: number;
  waitTime?: number;
  mouseButton?: string;
  offset?: { x: number; y: number };
}

/**
 * Action types supported by the automation framework
 */
export type ActionType = "FIND" | "CLICK" | "TYPE" | "DRAG" | "SCROLL" | "VANISH";

/**
 * ActionSnapshot represents a single recorded action during automation.
 * It captures the state of the GUI before and after an action, along with
 * metadata about the action's execution.
 */
export interface ActionSnapshot {
  /** Unique identifier for this snapshot */
  id: string;

  /** When this snapshot was created */
  timestamp: Date;

  /** Type of action performed */
  actionType: ActionType;

  /** Configuration parameters for the action */
  actionConfig: ActionConfig;

  /** Pattern matches found during this action */
  matches: MatchRegion[];

  /** Name of the state this action belongs to */
  stateName: string;

  /** ID of the state this action belongs to */
  stateId: string;

  /** List of states that were active during this action */
  activeStates: string[];

  /** Whether the action itself executed successfully */
  actionSuccess: boolean;

  /** Whether the expected result was achieved */
  resultSuccess: boolean;

  /** ID of the screenshot taken before this action */
  screenshotId: string;

  /** ID of the screenshot taken after this action (if state changed) */
  nextScreenshotId?: string;

  /** Duration of the action in milliseconds */
  duration: number;

  /** Text input (for TYPE actions) */
  text?: string;
}
