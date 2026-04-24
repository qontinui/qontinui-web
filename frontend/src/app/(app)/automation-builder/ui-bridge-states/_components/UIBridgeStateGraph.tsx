"use client";

/**
 * UIBridgeStateGraph — Thin wrapper around the shared StateMachineGraphView.
 *
 * Adds drag-and-drop element reassignment and maps transition selection
 * to database IDs (used by the web app's API layer).
 *
 * Also wires up per-config chunk-label overrides for the chunked graph
 * view. The web build has no Tauri/Postgres backend for these, so the
 * hook persists them in `localStorage` under the key
 * `qontinui.chunkLabels:<configId>` (keyed so switching configs loads
 * the right set).
 */

import { useCallback, useEffect, useState } from "react";
import dagre from "dagre";
import { StateMachineGraphView } from "@qontinui/workflow-ui/state-machine";
import "@xyflow/react/dist/style.css";
import type {
  StateMachineState,
  StateMachineTransition,
  PathfindingStep,
} from "../_types";

interface UIBridgeStateGraphProps {
  states: StateMachineState[];
  transitions: StateMachineTransition[];
  selectedStateId: string | null;
  selectedTransitionId: string | null;
  onSelectState: (stateId: string | null) => void;
  onSelectTransition: (transitionId: string | null) => void;
  highlightedPath?: PathfindingStep[];
  initialStateId?: string | null;
  onStartElementDrag?: (stateId: string, elementId: string) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
  isDragging?: boolean;
  dropTargetStateId?: string | null;
  onDeleteTransition?: (id: string) => void;
  /**
   * Active config id. Used to scope chunk-label persistence. When null,
   * the rename affordance is disabled (no target to persist against).
   */
  configId?: string | null;
}

// --- Chunk label persistence (localStorage) ---

function lsKey(configId: string | null | undefined): string | null {
  return configId ? `qontinui.chunkLabels:${configId}` : null;
}

function loadFromLS(key: string | null): Map<string, string> {
  if (
    !key ||
    typeof window === "undefined" ||
    typeof localStorage === "undefined"
  ) {
    return new Map();
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (typeof v === "string" && v.length > 0) m.set(k, v);
    }
    return m;
  } catch {
    return new Map();
  }
}

function useChunkLabels(configId: string | null | undefined) {
  const key = lsKey(configId);
  const [labels, setLabels] = useState<Map<string, string>>(() =>
    loadFromLS(key)
  );

  // Reload when the config changes (also clears to a fresh map when configId is null).
  useEffect(() => {
    setLabels(loadFromLS(key));
  }, [key]);

  const saveLabel = useCallback(
    (chunkId: string, label: string) => {
      if (!key) return;
      setLabels((prev) => {
        const next = new Map(prev);
        const trimmed = label.trim();
        if (!trimmed) {
          next.delete(chunkId);
        } else {
          next.set(chunkId, trimmed);
        }
        try {
          if (typeof localStorage !== "undefined") {
            if (next.size === 0) {
              localStorage.removeItem(key);
            } else {
              localStorage.setItem(
                key,
                JSON.stringify(Object.fromEntries(next))
              );
            }
          }
        } catch {
          // Quota / disabled storage — fall back to in-memory only.
        }
        return next;
      });
    },
    [key]
  );

  return { labels, saveLabel };
}

export function UIBridgeStateGraph({
  states,
  transitions,
  selectedStateId,
  selectedTransitionId,
  onSelectState,
  onSelectTransition,
  highlightedPath,
  initialStateId,
  onStartElementDrag,
  onDragOver,
  onDrop,
  isDragging,
  dropTargetStateId,
  onDeleteTransition,
  configId,
}: UIBridgeStateGraphProps) {
  const { labels: chunkLabels, saveLabel: onSaveChunkLabel } =
    useChunkLabels(configId);

  return (
    <StateMachineGraphView
      dagre={dagre}
      states={states}
      transitions={transitions}
      selectedStateId={selectedStateId}
      selectedTransitionId={selectedTransitionId}
      onSelectState={onSelectState}
      onSelectTransition={onSelectTransition}
      onDeleteTransition={onDeleteTransition}
      highlightedPath={highlightedPath}
      initialStateId={initialStateId}
      emptyMessage="No states discovered yet. Use the Discovery tab to discover states."
      onStartElementDrag={onStartElementDrag}
      onDragOver={onDragOver}
      onDrop={onDrop}
      isDragging={isDragging}
      dropTargetStateId={dropTargetStateId}
      resolveTransitionSelectionId={(trans) => trans.id}
      extraShortcutEntries={[
        ["Create transition", "Drag element"],
        ["Move element", "Alt+Drag"],
      ]}
      chunkLabels={chunkLabels}
      onSaveChunkLabel={configId ? onSaveChunkLabel : undefined}
    />
  );
}
