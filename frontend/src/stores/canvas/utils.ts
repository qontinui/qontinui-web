/**
 * Canvas Store Utilities
 *
 * Shared utility functions used across multiple slices
 */

import type { Action, Connections, Connection } from "./types";

/**
 * Generate a unique ID for actions
 */
export function generateActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate an edge ID from connection data
 */
export function getEdgeId(
  sourceId: string,
  outputType: string,
  outputIndex: number,
  targetId: string
): string {
  return `${sourceId}-${outputType}-${outputIndex}-${targetId}`;
}

/**
 * Deep clone an action with a new ID
 */
export function cloneAction(
  action: Action,
  offset: { x: number; y: number } = { x: 0, y: 0 }
): Action {
  return {
    ...action,
    id: generateActionId(),
    position: [action.position[0] + offset.x, action.position[1] + offset.y],
  };
}

/**
 * Update connections when actions are cloned
 */
export function updateConnectionsForClonedActions(
  connections: Connections,
  oldToNewIdMap: Map<string, string>
): Connections {
  const newConnections: Connections = {};

  for (const [sourceId, connectionTypes] of Object.entries(connections)) {
    const newSourceId = oldToNewIdMap.get(sourceId) || sourceId;

    newConnections[newSourceId] = {};

    for (const [type, outputs] of Object.entries(connectionTypes)) {
      (newConnections[newSourceId][type as keyof typeof connectionTypes] as Connection[][]) = outputs.map((outputConnections) =>
        outputConnections.map((conn) => ({
          ...conn,
          action: oldToNewIdMap.get(conn.action) || conn.action,
        }))
      );
    }
  }

  return newConnections;
}

/**
 * Deep clone an object (workflow, etc.)
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
