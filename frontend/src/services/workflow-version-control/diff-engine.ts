/**
 * Workflow Version Control - Diff Engine
 *
 * Computes detailed structural diffs between workflows.
 */

import type {
  Action,
  Workflow,
  Connections,
} from "../../lib/action-schema/action-types";
import type {
  VersionDiff,
  ActionDiff,
  ActionModification,
  ConnectionDiff,
  ConnectionModification,
  PropertyChange,
  VariableChange,
  DiffSummary,
  ChangeSummary,
} from "./types";

// ============================================================================
// Diff Engine
// ============================================================================

/**
 * Get detailed diff between two workflows
 */
export function getDiff(workflow1: Workflow, workflow2: Workflow): VersionDiff {
  const actionsAdded: ActionDiff[] = [];
  const actionsRemoved: ActionDiff[] = [];
  const actionsModified: ActionModification[] = [];
  const actionsUnchanged: string[] = [];

  const ids1 = new Set(workflow1.actions.map((a) => a.id));
  const ids2 = new Set(workflow2.actions.map((a) => a.id));

  // Find added actions
  workflow2.actions.forEach((action) => {
    if (!ids1.has(action.id)) {
      actionsAdded.push({
        id: action.id,
        type: action.type,
        name: action.name,
        position: action.position,
        config: action.config,
      });
    }
  });

  // Find removed actions
  workflow1.actions.forEach((action) => {
    if (!ids2.has(action.id)) {
      actionsRemoved.push({
        id: action.id,
        type: action.type,
        name: action.name,
        position: action.position,
        config: action.config,
      });
    }
  });

  // Find modified and unchanged actions
  workflow1.actions.forEach((action1) => {
    if (ids2.has(action1.id)) {
      const action2 = workflow2.actions.find((a) => a.id === action1.id)!;
      const modification = compareActions(action1, action2);

      if (modification) {
        actionsModified.push({
          id: action1.id,
          changes: modification,
        });
      } else {
        actionsUnchanged.push(action1.id);
      }
    }
  });

  // Compare connections
  const connectionChanges = compareConnections(
    workflow1.connections,
    workflow2.connections
  );

  // Compare properties
  const propertiesChanged = compareProperties(workflow1, workflow2);

  // Compare variables
  const variablesChanged = compareVariables(workflow1, workflow2);

  // Calculate summary
  const summary: DiffSummary = {
    actionsAdded: actionsAdded.length,
    actionsRemoved: actionsRemoved.length,
    actionsModified: actionsModified.length,
    connectionsChanged:
      connectionChanges.connectionsAdded.length +
      connectionChanges.connectionsRemoved.length +
      connectionChanges.connectionsModified.length,
    propertiesChanged: propertiesChanged.length,
    variablesChanged: variablesChanged.length,
    totalChanges:
      actionsAdded.length +
      actionsRemoved.length +
      actionsModified.length +
      connectionChanges.connectionsAdded.length +
      connectionChanges.connectionsRemoved.length +
      connectionChanges.connectionsModified.length +
      propertiesChanged.length +
      variablesChanged.length,
  };

  return {
    actionsAdded,
    actionsRemoved,
    actionsModified,
    actionsUnchanged,
    ...connectionChanges,
    propertiesChanged,
    variablesChanged,
    summary,
  };
}

/**
 * Summarize changes in human-readable format
 */
export function summarizeChanges(changes: VersionDiff): ChangeSummary {
  const propertiesChanged = changes.propertiesChanged.map((p) => p.property);

  return {
    actionsAdded: changes.actionsAdded.length,
    actionsRemoved: changes.actionsRemoved.length,
    actionsModified: changes.actionsModified.length,
    connectionsChanged: changes.summary.connectionsChanged,
    propertiesChanged,
    hasStructuralChanges:
      changes.actionsAdded.length > 0 ||
      changes.actionsRemoved.length > 0 ||
      changes.summary.connectionsChanged > 0,
    hasConfigChanges: changes.actionsModified.length > 0,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

function compareActions(
  action1: Action,
  action2: Action
): ActionModification["changes"] | null {
  const changes: ActionModification["changes"] = {};

  if (action1.type !== action2.type) {
    changes.type = { old: action1.type, new: action2.type };
  }

  if (action1.name !== action2.name) {
    changes.name = { old: action1.name, new: action2.name };
  }

  const config1 = JSON.stringify(action1.config);
  const config2 = JSON.stringify(action2.config);
  if (config1 !== config2) {
    changes.config = {
      old: action1.config,
      new: action2.config,
      fields: getChangedFields(action1.config, action2.config),
    };
  }

  const pos1 = JSON.stringify(action1.position);
  const pos2 = JSON.stringify(action2.position);
  if (pos1 !== pos2) {
    changes.position = { old: action1.position, new: action2.position };
  }

  const base1 = JSON.stringify(action1.base);
  const base2 = JSON.stringify(action2.base);
  if (base1 !== base2) {
    changes.base = { old: action1.base, new: action2.base };
  }

  const exec1 = JSON.stringify(action1.execution);
  const exec2 = JSON.stringify(action2.execution);
  if (exec1 !== exec2) {
    changes.execution = { old: action1.execution, new: action2.execution };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

function getChangedFields(obj1: unknown, obj2: unknown): string[] {
  const fields: string[] = [];
  const record1 = obj1 as Record<string, unknown> | null | undefined;
  const record2 = obj2 as Record<string, unknown> | null | undefined;
  const allKeys = new Set([
    ...Object.keys(record1 || {}),
    ...Object.keys(record2 || {}),
  ]);

  allKeys.forEach((key) => {
    if (JSON.stringify(record1?.[key]) !== JSON.stringify(record2?.[key])) {
      fields.push(key);
    }
  });

  return fields;
}

function compareConnections(
  connections1: Connections,
  connections2: Connections
): {
  connectionsAdded: ConnectionDiff[];
  connectionsRemoved: ConnectionDiff[];
  connectionsModified: ConnectionModification[];
} {
  const added: ConnectionDiff[] = [];
  const removed: ConnectionDiff[] = [];
  const modified: ConnectionModification[] = [];

  const allSources = new Set([
    ...Object.keys(connections1),
    ...Object.keys(connections2),
  ]);

  allSources.forEach((source) => {
    const conns1 = connections1[source];
    const conns2 = connections2[source];

    if (!conns1 && conns2) {
      // All connections from this source are new
      extractConnections(conns2, source).forEach((conn) => added.push(conn));
    } else if (conns1 && !conns2) {
      // All connections from this source are removed
      extractConnections(conns1, source).forEach((conn) => removed.push(conn));
    } else if (conns1 && conns2) {
      // Compare connections
      const conns1List = extractConnections(conns1, source);
      const conns2List = extractConnections(conns2, source);

      conns2List.forEach((conn2) => {
        const exists = conns1List.some(
          (conn1) =>
            conn1.target === conn2.target &&
            conn1.type === conn2.type &&
            conn1.outputIndex === conn2.outputIndex
        );
        if (!exists) {
          added.push(conn2);
        }
      });

      conns1List.forEach((conn1) => {
        const exists = conns2List.some(
          (conn2) =>
            conn1.target === conn2.target &&
            conn1.type === conn2.type &&
            conn1.outputIndex === conn2.outputIndex
        );
        if (!exists) {
          removed.push(conn1);
        }
      });
    }
  });

  return {
    connectionsAdded: added,
    connectionsRemoved: removed,
    connectionsModified: modified,
  };
}

function extractConnections(
  outputs: Connections[string],
  source: string
): ConnectionDiff[] {
  const connections: ConnectionDiff[] = [];

  (["main", "error", "success", "parallel"] as const).forEach((type) => {
    const conns = outputs[type as keyof typeof outputs];
    if (conns) {
      conns.forEach((outputConns, outputIndex: number) => {
        if (Array.isArray(outputConns)) {
          outputConns.forEach((conn) => {
            connections.push({
              source,
              target: conn.action,
              type: type,
              outputIndex,
              inputIndex: conn.index,
            });
          });
        }
      });
    }
  });

  return connections;
}

function compareProperties(
  workflow1: Workflow,
  workflow2: Workflow
): PropertyChange[] {
  const changes: PropertyChange[] = [];

  const properties = [
    "name",
    "description",
    "category",
    "version",
    "tags",
    "settings",
  ];

  properties.forEach((prop) => {
    const val1 = (workflow1 as unknown as Record<string, unknown>)[prop];
    const val2 = (workflow2 as unknown as Record<string, unknown>)[prop];

    if (JSON.stringify(val1) !== JSON.stringify(val2)) {
      changes.push({
        property: prop,
        oldValue: val1,
        newValue: val2,
      });
    }
  });

  return changes;
}

function compareVariables(
  workflow1: Workflow,
  workflow2: Workflow
): VariableChange[] {
  const changes: VariableChange[] = [];

  const scopes: Array<"local" | "process" | "global"> = [
    "local",
    "process",
    "global",
  ];

  scopes.forEach((scope) => {
    const vars1 = workflow1.variables?.[scope] || {};
    const vars2 = workflow2.variables?.[scope] || {};

    const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)]);

    allKeys.forEach((key) => {
      const val1 = vars1[key];
      const val2 = vars2[key];

      if (val1 === undefined && val2 !== undefined) {
        changes.push({ scope, key, newValue: val2, type: "added" });
      } else if (val1 !== undefined && val2 === undefined) {
        changes.push({ scope, key, oldValue: val1, type: "removed" });
      } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        changes.push({
          scope,
          key,
          oldValue: val1,
          newValue: val2,
          type: "modified",
        });
      }
    });
  });

  return changes;
}
