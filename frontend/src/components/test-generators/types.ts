/**
 * Test Generator Types
 *
 * Imports spec types from @qontinui/ui-bridge/specs.
 * Defines local types for state machine data and generator metadata.
 */

export type {
  SpecCategory,
  SpecSeverity,
  SpecSource,
  SpecTarget,
  SpecAssertion,
  SpecGroup,
  SpecConfig,
  SpecMetadata,
  AssertionType,
  SearchCriteria,
} from "@qontinui/ui-bridge/specs";

// Local types for state machine data (not part of spec format)

export interface NonVisualState {
  id: string;
  name: string;
  description: string;
  elementIds: string[];
  pageUrl?: string;
  pageTitle?: string;
  confidence: number;
}

export interface NonVisualTransition {
  id: string;
  triggerElementId: string;
  triggerLabel?: string;
  triggerAction: "click" | "type" | "hover" | "scroll" | "custom";
  fromStateId: string;
  toStateId: string;
  confidence: number;
}

export interface SnapshotMetadata {
  snapshotId: string;
  pageUrl: string;
  pageTitle: string;
  capturedAt: string;
  elementCount: number;
  formCount: number;
  modalCount: number;
}

export interface ExplorationMetadata {
  explorationId: string;
  targetUrl: string;
  statesDiscovered: number;
  transitionsDiscovered: number;
  exploredAt: string;
}

// Generator metadata stored in SpecConfig.metadata
export interface GeneratorSpecMetadata {
  generatorType?: "snapshot" | "navigation";
  projectId?: string;
  states?: NonVisualState[];
  transitions?: NonVisualTransition[];
  snapshotMetadata?: SnapshotMetadata;
  explorationMetadata?: ExplorationMetadata;
  [key: string]: unknown;
}

// Category display labels
import type { SpecCategory, SpecSeverity } from "@qontinui/ui-bridge/specs";

export const CATEGORY_LABELS: Record<SpecCategory, string> = {
  "element-presence": "Element Presence",
  accessibility: "Accessibility",
  "form-validation": "Form Validation",
  "state-consistency": "State Consistency",
  "modal-dialog": "Modal / Dialog",
  navigation: "Navigation",
  "cross-page-consistency": "Cross-Page Consistency",
  custom: "Custom",
};

export const SEVERITY_COLORS: Record<SpecSeverity, string> = {
  critical: "text-red-400",
  warning: "text-yellow-400",
  info: "text-blue-400",
};
