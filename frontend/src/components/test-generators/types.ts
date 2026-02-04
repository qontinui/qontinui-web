/**
 * Test Generator Types
 *
 * Local type definitions for test generators. These are backward-compatible
 * with the legacy format and used by the spec generators and UI components.
 *
 * For the canonical spec types, import from @qontinui/ui-bridge/specs.
 * The migration module can convert between these formats.
 */

// Re-export canonical types under their new names for consumers ready to migrate
export type {
  SpecCategory,
  SpecSeverity,
  SpecSource,
  SpecTarget,
  SpecAssertion,
  SpecGroup,
  SpecConfig,
} from "@qontinui/ui-bridge/specs";

// Legacy types used by spec generators and existing UI components.
// These match the old TestGeneratorOutput format and will be consumed
// by migrateFromTestGeneratorOutput() when producing SpecConfig.

export type TestCategory =
  | "element-presence"
  | "accessibility"
  | "form-validation"
  | "state-consistency"
  | "modal-dialog"
  | "navigation"
  | "cross-page-consistency"
  | "custom";

export type TestSeverity = "critical" | "warning" | "info";

export type TestTarget =
  | { type: "elementId"; elementId: string; label?: string }
  | { type: "formId"; formId: string; label?: string }
  | { type: "modalId"; modalId: string; label?: string };

export interface TestAssertion {
  id: string;
  description: string;
  category: TestCategory;
  severity: TestSeverity;
  target: TestTarget;
  assertionType: string;
  expected?: unknown;
  attributeName?: string;
  source: "auto" | "manual";
  reviewed: boolean;
  enabled: boolean;
  notes?: string;
}

export interface TestSpecification {
  id: string;
  name: string;
  description: string;
  category: TestCategory;
  assertions: TestAssertion[];
  stateId: string;
  transitionId?: string;
  source: "auto" | "manual";
  createdAt: string;
  updatedAt: string;
}

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

export interface TestGeneratorOutput {
  version: "1.0.0";
  projectId: string;
  generatorType: "snapshot" | "navigation";
  states: NonVisualState[];
  transitions: NonVisualTransition[];
  testSpecifications: TestSpecification[];
  snapshotMetadata?: SnapshotMetadata;
  explorationMetadata?: ExplorationMetadata;
  createdAt: string;
  updatedAt: string;
}

// Category display labels
export const CATEGORY_LABELS: Record<TestCategory, string> = {
  "element-presence": "Element Presence",
  "accessibility": "Accessibility",
  "form-validation": "Form Validation",
  "state-consistency": "State Consistency",
  "modal-dialog": "Modal / Dialog",
  "navigation": "Navigation",
  "cross-page-consistency": "Cross-Page Consistency",
  "custom": "Custom",
};

export const SEVERITY_COLORS: Record<TestSeverity, string> = {
  critical: "text-red-400",
  warning: "text-yellow-400",
  info: "text-blue-400",
};
