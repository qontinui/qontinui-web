/**
 * Spec Generators
 *
 * Pure functions for generating spec groups from snapshot and exploration data.
 * Used by both Snapshot Test Generator (Tier 1) and Navigation Test Generator (Tier 2).
 */

import type {
  SpecAssertion,
  SpecGroup,
  SpecCategory,
  SpecSeverity,
  SpecTarget,
  AssertionType,
} from "@qontinui/ui-bridge/specs";
import type { NonVisualState, NonVisualTransition } from "../types";

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
  category: SpecCategory,
  severity: SpecSeverity,
  target: SpecTarget,
  assertionType: AssertionType,
  expected?: unknown,
  attributeName?: string
): SpecAssertion {
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

function createGroup(
  name: string,
  description: string,
  category: SpecCategory,
  assertions: SpecAssertion[],
  stateId?: string,
  transitionId?: string
): SpecGroup {
  return {
    id: generateId("group"),
    name,
    description,
    category,
    assertions,
    stateId,
    transitionId,
    source: "auto",
  };
}

function elementTarget(elementId: string, label?: string): SpecTarget {
  return { type: "elementId", elementId, label };
}

function searchTarget(
  idPattern: string,
  role: string,
  label?: string
): SpecTarget {
  return { type: "search", criteria: { idPattern, role }, label };
}

// --- Snapshot-based generation (Tier 1) --------------------------------------

function generateElementPresenceAssertions(
  elements: SnapshotElement[]
): SpecAssertion[] {
  return elements.map((el) => {
    const severity: SpecSeverity = el.isInteractive ? "critical" : "info";
    const label = el.label || el.id;
    return createAssertion(
      `"${label}" ${el.type} exists`,
      "element-presence",
      severity,
      elementTarget(el.id, label),
      "exists"
    );
  });
}

function generateAccessibilityAssertions(
  elements: SnapshotElement[]
): SpecAssertion[] {
  const assertions: SpecAssertion[] = [];
  for (const el of elements) {
    if (!el.isInteractive) continue;
    const label = el.label || el.id;

    if (el.role) {
      assertions.push(
        createAssertion(
          `"${label}" has ARIA role "${el.role}"`,
          "accessibility",
          "warning",
          elementTarget(el.id, label),
          "attribute",
          el.role,
          "role"
        )
      );
    }

    if (el.ariaLabel) {
      assertions.push(
        createAssertion(
          `"${label}" has accessible name`,
          "accessibility",
          "warning",
          elementTarget(el.id, label),
          "attribute",
          el.ariaLabel,
          "aria-label"
        )
      );
    }
  }
  return assertions;
}

function generateFormAssertions(forms: SnapshotForm[]): SpecAssertion[] {
  const assertions: SpecAssertion[] = [];
  for (const form of forms) {
    const formLabel = form.name || form.id;

    if (form.hasSubmitButton) {
      assertions.push(
        createAssertion(
          `"${formLabel}" form has submit button`,
          "form-validation",
          "critical",
          searchTarget(form.id, "form", formLabel),
          "exists"
        )
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
            elementTarget(field.id, fieldLabel),
            "attribute",
            "true",
            "required"
          )
        );
      }
    }
  }
  return assertions;
}

function generateModalAssertions(modals: SnapshotModal[]): SpecAssertion[] {
  const assertions: SpecAssertion[] = [];
  for (const modal of modals) {
    const label = modal.title || modal.id;
    if (modal.hasCloseButton) {
      assertions.push(
        createAssertion(
          `"${label}" modal has close button`,
          "modal-dialog",
          "critical",
          searchTarget(modal.id, "dialog", label),
          "exists"
        )
      );
    }
    if (modal.isBlocking) {
      assertions.push(
        createAssertion(
          `"${label}" modal is blocking`,
          "modal-dialog",
          "warning",
          searchTarget(modal.id, "dialog", label),
          "attribute",
          "true",
          "aria-modal"
        )
      );
    }
  }
  return assertions;
}

function generateStateConsistencyAssertions(
  elements: SnapshotElement[]
): SpecAssertion[] {
  const assertions: SpecAssertion[] = [];
  for (const el of elements) {
    const label = el.label || el.id;

    if (el.isVisible) {
      assertions.push(
        createAssertion(
          `"${label}" is visible`,
          "state-consistency",
          el.isInteractive ? "critical" : "info",
          elementTarget(el.id, label),
          "visible"
        )
      );
    }

    if (el.isInteractive && el.isEnabled) {
      assertions.push(
        createAssertion(
          `"${label}" is enabled`,
          "state-consistency",
          "critical",
          elementTarget(el.id, label),
          "enabled"
        )
      );
    }
  }
  return assertions;
}

/** Get the primary ID from a SpecTarget */
function getTargetId(target: SpecTarget): string | undefined {
  if (target.type === "elementId") return target.elementId;
  if (target.type === "search") return target.criteria.idPattern;
  return undefined;
}

export function generateSpecsFromSnapshot(
  data: SnapshotData,
  stateId: string
): SpecGroup[] {
  const groups: SpecGroup[] = [];

  // Element Presence
  const presenceAssertions = generateElementPresenceAssertions(data.elements);
  if (presenceAssertions.length > 0) {
    groups.push(
      createGroup(
        "Element Presence",
        `Verify ${presenceAssertions.length} elements exist on the page`,
        "element-presence",
        presenceAssertions,
        stateId
      )
    );
  }

  // Accessibility
  const a11yAssertions = generateAccessibilityAssertions(data.elements);
  if (a11yAssertions.length > 0) {
    groups.push(
      createGroup(
        "Accessibility",
        `Verify ARIA roles and accessible names for ${a11yAssertions.length} interactive elements`,
        "accessibility",
        a11yAssertions,
        stateId
      )
    );
  }

  // Form Validation
  const formAssertions = generateFormAssertions(data.forms);
  if (formAssertions.length > 0) {
    for (const form of data.forms) {
      const formLabel = form.name || form.id;
      const formGroupAssertions = formAssertions.filter((a) => {
        const targetId = getTargetId(a.target);
        if (a.target.type === "search") {
          return targetId === form.id;
        }
        return form.fields.some((f) => f.id === targetId);
      });
      if (formGroupAssertions.length > 0) {
        groups.push(
          createGroup(
            `Form: ${formLabel}`,
            `Validate "${formLabel}" form structure and requirements`,
            "form-validation",
            formGroupAssertions,
            stateId
          )
        );
      }
    }
  }

  // Modal / Dialog
  const modalAssertions = generateModalAssertions(data.modals);
  if (modalAssertions.length > 0) {
    groups.push(
      createGroup(
        "Modals & Dialogs",
        `Verify ${data.modals.length} modal/dialog components`,
        "modal-dialog",
        modalAssertions,
        stateId
      )
    );
  }

  // State Consistency (only for interactive elements to keep spec count manageable)
  const interactiveElements = data.elements.filter((e) => e.isInteractive);
  const stateAssertions =
    generateStateConsistencyAssertions(interactiveElements);
  if (stateAssertions.length > 0) {
    groups.push(
      createGroup(
        "State Consistency",
        `Verify visibility and enabled state of ${interactiveElements.length} interactive elements`,
        "state-consistency",
        stateAssertions,
        stateId
      )
    );
  }

  return groups;
}

// --- Navigation-based generation (Tier 2) ------------------------------------

export function generateNavigationTestSpecs(
  states: NonVisualState[],
  transitions: NonVisualTransition[],
  snapshotsByState: Map<string, SnapshotData>
): SpecGroup[] {
  const groups: SpecGroup[] = [];

  // Per-state groups
  for (const state of states) {
    const snapshot = snapshotsByState.get(state.id);
    if (snapshot) {
      const stateGroups = generateSpecsFromSnapshot(snapshot, state.id);
      groups.push(...stateGroups);
    }
  }

  // Per-transition groups
  for (const transition of transitions) {
    const fromState = states.find((s) => s.id === transition.fromStateId);
    const toState = states.find((s) => s.id === transition.toStateId);
    if (!fromState || !toState) continue;

    const triggerLabel = transition.triggerLabel || transition.triggerElementId;
    const assertions: SpecAssertion[] = [];

    // Trigger element exists in source state
    assertions.push(
      createAssertion(
        `"${triggerLabel}" exists in "${fromState.name}"`,
        "navigation",
        "critical",
        elementTarget(transition.triggerElementId, triggerLabel),
        "exists"
      )
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
            elementTarget(el.id, label),
            "exists"
          )
        );
      }
    }

    if (assertions.length > 0) {
      groups.push(
        createGroup(
          `${fromState.name} → ${toState.name}`,
          `Verify transition from "${fromState.name}" to "${toState.name}" via ${transition.triggerAction} on "${triggerLabel}"`,
          "navigation",
          assertions,
          fromState.id,
          transition.id
        )
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
      ([, stateIds]) => stateIds.length > 1
    );

    if (sharedElements.length > 0) {
      const crossPageAssertions = sharedElements
        .slice(0, 20)
        .map(([elId, stateIds]) =>
          createAssertion(
            `"${elId}" consistent across ${stateIds.length} states`,
            "cross-page-consistency",
            "warning",
            elementTarget(elId),
            "exists"
          )
        );

      groups.push(
        createGroup(
          "Cross-Page Consistency",
          `Verify ${sharedElements.length} elements shared across multiple states`,
          "cross-page-consistency",
          crossPageAssertions,
          states[0]!.id
        )
      );
    }
  }

  return groups;
}
