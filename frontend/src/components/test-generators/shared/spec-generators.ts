/**
 * Spec Generators
 *
 * Pure functions for generating test specifications from snapshot and exploration data.
 * Used by both Snapshot Test Generator (Tier 1) and Navigation Test Generator (Tier 2).
 */

import type {
  TestAssertion,
  TestSpecification,
  TestCategory,
  TestSeverity,
  NonVisualState,
  NonVisualTransition,
} from "../types";

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

// Element info from a snapshot
export interface SnapshotElement {
  id: string;
  type: string; // "button" | "input" | "link" | "select" | "textarea" | etc.
  label?: string;
  role?: string;
  ariaLabel?: string;
  isInteractive: boolean;
  isVisible: boolean;
  isEnabled: boolean;
  isRequired?: boolean;
  value?: string;
  checked?: boolean;
  formId?: string;
  attributes?: Record<string, string>;
}

export interface SnapshotForm {
  id: string;
  name?: string;
  action?: string;
  fields: SnapshotElement[];
  hasSubmitButton: boolean;
}

export interface SnapshotModal {
  id: string;
  title?: string;
  isOpen: boolean;
  hasCloseButton: boolean;
  isBlocking: boolean;
}

export interface SnapshotData {
  elements: SnapshotElement[];
  forms: SnapshotForm[];
  modals: SnapshotModal[];
  pageUrl?: string;
  pageTitle?: string;
}

function createAssertion(
  description: string,
  category: TestCategory,
  severity: TestSeverity,
  target: TestAssertion["target"],
  assertionType: string,
  expected?: unknown,
  attributeName?: string,
): TestAssertion {
  return {
    id: generateId("assertion"),
    description,
    category,
    severity,
    target,
    assertionType,
    expected,
    attributeName,
    source: "auto",
    reviewed: false,
    enabled: true,
  };
}

function createSpec(
  name: string,
  description: string,
  category: TestCategory,
  assertions: TestAssertion[],
  stateId: string,
  transitionId?: string,
): TestSpecification {
  const now = new Date().toISOString();
  return {
    id: generateId("spec"),
    name,
    description,
    category,
    assertions,
    stateId,
    transitionId,
    source: "auto",
    createdAt: now,
    updatedAt: now,
  };
}

// --- Snapshot-based generation (Tier 1) --------------------------------------

function generateElementPresenceAssertions(
  elements: SnapshotElement[],
): TestAssertion[] {
  return elements.map((el) => {
    const severity: TestSeverity = el.isInteractive ? "critical" : "info";
    const label = el.label || el.id;
    return createAssertion(
      `"${label}" ${el.type} exists`,
      "element-presence",
      severity,
      { type: "elementId", elementId: el.id, label },
      "exists",
    );
  });
}

function generateAccessibilityAssertions(
  elements: SnapshotElement[],
): TestAssertion[] {
  const assertions: TestAssertion[] = [];
  for (const el of elements) {
    if (!el.isInteractive) continue;
    const label = el.label || el.id;

    if (el.role) {
      assertions.push(
        createAssertion(
          `"${label}" has ARIA role "${el.role}"`,
          "accessibility",
          "warning",
          { type: "elementId", elementId: el.id, label },
          "attribute",
          el.role,
          "role",
        ),
      );
    }

    if (el.ariaLabel) {
      assertions.push(
        createAssertion(
          `"${label}" has accessible name`,
          "accessibility",
          "warning",
          { type: "elementId", elementId: el.id, label },
          "attribute",
          el.ariaLabel,
          "aria-label",
        ),
      );
    }
  }
  return assertions;
}

function generateFormAssertions(forms: SnapshotForm[]): TestAssertion[] {
  const assertions: TestAssertion[] = [];
  for (const form of forms) {
    const formLabel = form.name || form.id;

    if (form.hasSubmitButton) {
      assertions.push(
        createAssertion(
          `"${formLabel}" form has submit button`,
          "form-validation",
          "critical",
          { type: "formId", formId: form.id, label: formLabel },
          "exists",
        ),
      );
    }

    for (const field of form.fields) {
      if (field.isRequired) {
        const fieldLabel = field.label || field.id;
        assertions.push(
          createAssertion(
            `"${fieldLabel}" field is required`,
            "form-validation",
            "critical",
            { type: "elementId", elementId: field.id, label: fieldLabel },
            "attribute",
            "true",
            "required",
          ),
        );
      }
    }
  }
  return assertions;
}

function generateModalAssertions(modals: SnapshotModal[]): TestAssertion[] {
  const assertions: TestAssertion[] = [];
  for (const modal of modals) {
    const label = modal.title || modal.id;
    if (modal.hasCloseButton) {
      assertions.push(
        createAssertion(
          `"${label}" modal has close button`,
          "modal-dialog",
          "critical",
          { type: "modalId", modalId: modal.id, label },
          "exists",
        ),
      );
    }
    if (modal.isBlocking) {
      assertions.push(
        createAssertion(
          `"${label}" modal is blocking`,
          "modal-dialog",
          "warning",
          { type: "modalId", modalId: modal.id, label },
          "attribute",
          "true",
          "aria-modal",
        ),
      );
    }
  }
  return assertions;
}

function generateStateConsistencyAssertions(
  elements: SnapshotElement[],
): TestAssertion[] {
  const assertions: TestAssertion[] = [];
  for (const el of elements) {
    const label = el.label || el.id;

    if (el.isVisible) {
      assertions.push(
        createAssertion(
          `"${label}" is visible`,
          "state-consistency",
          el.isInteractive ? "critical" : "info",
          { type: "elementId", elementId: el.id, label },
          "visible",
        ),
      );
    }

    if (el.isInteractive && el.isEnabled) {
      assertions.push(
        createAssertion(
          `"${label}" is enabled`,
          "state-consistency",
          "critical",
          { type: "elementId", elementId: el.id, label },
          "enabled",
        ),
      );
    }
  }
  return assertions;
}

export function generateSpecsFromSnapshot(
  data: SnapshotData,
  stateId: string,
): TestSpecification[] {
  const specs: TestSpecification[] = [];

  // Element Presence
  const presenceAssertions = generateElementPresenceAssertions(data.elements);
  if (presenceAssertions.length > 0) {
    specs.push(
      createSpec(
        "Element Presence",
        `Verify ${presenceAssertions.length} elements exist on the page`,
        "element-presence",
        presenceAssertions,
        stateId,
      ),
    );
  }

  // Accessibility
  const a11yAssertions = generateAccessibilityAssertions(data.elements);
  if (a11yAssertions.length > 0) {
    specs.push(
      createSpec(
        "Accessibility",
        `Verify ARIA roles and accessible names for ${a11yAssertions.length} interactive elements`,
        "accessibility",
        a11yAssertions,
        stateId,
      ),
    );
  }

  // Form Validation
  const formAssertions = generateFormAssertions(data.forms);
  if (formAssertions.length > 0) {
    for (const form of data.forms) {
      const formLabel = form.name || form.id;
      const formSpecAssertions = formAssertions.filter((a) =>
        a.target.type === "formId"
          ? a.target.formId === form.id
          : form.fields.some(
              (f) =>
                f.id ===
                (a.target as { elementId: string }).elementId,
            ),
      );
      if (formSpecAssertions.length > 0) {
        specs.push(
          createSpec(
            `Form: ${formLabel}`,
            `Validate "${formLabel}" form structure and requirements`,
            "form-validation",
            formSpecAssertions,
            stateId,
          ),
        );
      }
    }
  }

  // Modal / Dialog
  const modalAssertions = generateModalAssertions(data.modals);
  if (modalAssertions.length > 0) {
    specs.push(
      createSpec(
        "Modals & Dialogs",
        `Verify ${data.modals.length} modal/dialog components`,
        "modal-dialog",
        modalAssertions,
        stateId,
      ),
    );
  }

  // State Consistency (only for interactive elements to keep spec count manageable)
  const interactiveElements = data.elements.filter((e) => e.isInteractive);
  const stateAssertions =
    generateStateConsistencyAssertions(interactiveElements);
  if (stateAssertions.length > 0) {
    specs.push(
      createSpec(
        "State Consistency",
        `Verify visibility and enabled state of ${interactiveElements.length} interactive elements`,
        "state-consistency",
        stateAssertions,
        stateId,
      ),
    );
  }

  return specs;
}

// --- Navigation-based generation (Tier 2) ------------------------------------

export function generateNavigationTestSpecs(
  states: NonVisualState[],
  transitions: NonVisualTransition[],
  snapshotsByState: Map<string, SnapshotData>,
): TestSpecification[] {
  const specs: TestSpecification[] = [];

  // Per-state specs
  for (const state of states) {
    const snapshot = snapshotsByState.get(state.id);
    if (snapshot) {
      const stateSpecs = generateSpecsFromSnapshot(snapshot, state.id);
      specs.push(...stateSpecs);
    }
  }

  // Per-transition specs
  for (const transition of transitions) {
    const fromState = states.find((s) => s.id === transition.fromStateId);
    const toState = states.find((s) => s.id === transition.toStateId);
    if (!fromState || !toState) continue;

    const triggerLabel =
      transition.triggerLabel || transition.triggerElementId;
    const assertions: TestAssertion[] = [];

    // Trigger element exists in source state
    assertions.push(
      createAssertion(
        `"${triggerLabel}" exists in "${fromState.name}"`,
        "navigation",
        "critical",
        {
          type: "elementId",
          elementId: transition.triggerElementId,
          label: triggerLabel,
        },
        "exists",
      ),
    );

    // After action, target state elements appear
    const toSnapshot = snapshotsByState.get(toState.id);
    if (toSnapshot) {
      const keyElements = toSnapshot.elements
        .filter((e) => e.isInteractive)
        .slice(0, 5);
      for (const el of keyElements) {
        const label = el.label || el.id;
        assertions.push(
          createAssertion(
            `After ${transition.triggerAction}, "${label}" appears in "${toState.name}"`,
            "navigation",
            "critical",
            { type: "elementId", elementId: el.id, label },
            "exists",
          ),
        );
      }
    }

    if (assertions.length > 0) {
      specs.push(
        createSpec(
          `${fromState.name} → ${toState.name}`,
          `Verify transition from "${fromState.name}" to "${toState.name}" via ${transition.triggerAction} on "${triggerLabel}"`,
          "navigation",
          assertions,
          fromState.id,
          transition.id,
        ),
      );
    }
  }

  // Cross-page consistency
  if (states.length > 1) {
    const elementStateCounts = new Map<string, string[]>();
    for (const state of states) {
      for (const elId of state.elementIds) {
        const existing = elementStateCounts.get(elId) || [];
        existing.push(state.id);
        elementStateCounts.set(elId, existing);
      }
    }

    const sharedElements = Array.from(elementStateCounts.entries()).filter(
      ([, stateIds]) => stateIds.length > 1,
    );

    if (sharedElements.length > 0) {
      const crossPageAssertions = sharedElements
        .slice(0, 20)
        .map(([elId, stateIds]) =>
          createAssertion(
            `"${elId}" consistent across ${stateIds.length} states`,
            "cross-page-consistency",
            "warning",
            { type: "elementId", elementId: elId },
            "exists",
          ),
        );

      specs.push(
        createSpec(
          "Cross-Page Consistency",
          `Verify ${sharedElements.length} elements shared across multiple states`,
          "cross-page-consistency",
          crossPageAssertions,
          states[0]!.id,
        ),
      );
    }
  }

  return specs;
}
