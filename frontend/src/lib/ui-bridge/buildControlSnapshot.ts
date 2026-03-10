/**
 * Shared utility for building a ControlSnapshot from bridge elements.
 *
 * Both useUIBridgeCommandHandler (SSE) and useWebSocketCommandHandler (WS)
 * need identical snapshot construction logic. This module extracts that
 * shared code so neither handler duplicates it.
 */

import type { ControlSnapshot } from "@qontinui/ui-bridge/control";
import type { ElementState } from "@qontinui/ui-bridge/core";

/**
 * Minimal element interface matching the subset of RegisteredElement
 * used during snapshot construction.
 */
interface SnapshotElement {
  id: string;
  element: Element;
  type: string;
  label?: string;
  actions: string[];
  getState: () => ElementState;
}

/**
 * Build a ControlSnapshot from the current bridge elements and
 * global UI Bridge context providers (navigation, modal, toast,
 * relationship, drag-drop).
 */
export function buildControlSnapshot(
  elements: ReadonlyArray<SnapshotElement>
): ControlSnapshot {
  const w = window as unknown as Record<string, unknown>;
  const uiBridgeGlobal = w.__UI_BRIDGE__ as Record<string, unknown> | undefined;

  const navTracker = uiBridgeGlobal?.navigationTracker as
    | { getSnapshotPageContext: () => unknown }
    | undefined;
  const modalDetector = uiBridgeGlobal?.modalDetector as
    | { getSnapshotModalContext: () => unknown }
    | undefined;
  const toastCap = uiBridgeGlobal?.toastCapture as
    | { getSnapshotToastContext: () => unknown }
    | undefined;
  const relTracker = uiBridgeGlobal?.relationshipTracker as
    | {
        getSnapshotRelationshipContext: (
          elements?: Array<{ id: string; element: Element }>
        ) => unknown;
      }
    | undefined;
  const dndDetector = uiBridgeGlobal?.dragDropDetector as
    | {
        getSnapshotDragDropContext: (
          elements?: Array<{ id: string; element: Element }>
        ) => unknown;
      }
    | undefined;

  const elementPairs = elements.map((e) => ({
    id: e.id,
    element: e.element,
  }));

  const snapshot: ControlSnapshot = {
    timestamp: Date.now(),
    elements: elements.map((e) => {
      const state = e.getState();
      return {
        id: e.id,
        type: e.type,
        label: e.label,
        actions: e.actions,
        state: state,
      };
    }),
    components: [],
    workflows: [],
    activeRuns: [],
    page: navTracker?.getSnapshotPageContext() as ControlSnapshot["page"],
    modalStack:
      modalDetector?.getSnapshotModalContext() as ControlSnapshot["modalStack"],
    toasts: toastCap?.getSnapshotToastContext() as ControlSnapshot["toasts"],
    relationships: relTracker?.getSnapshotRelationshipContext(
      elementPairs
    ) as ControlSnapshot["relationships"],
    dragDrop: dndDetector?.getSnapshotDragDropContext(
      elementPairs
    ) as ControlSnapshot["dragDrop"],
  };

  return snapshot;
}
