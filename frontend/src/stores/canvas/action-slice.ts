/**
 * Action Slice - Manages action CRUD operations
 *
 * Responsibilities:
 * - Adding/updating/deleting actions
 * - Duplicating and moving actions
 * - Querying actions
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, ActionSlice, Action, Connection } from "./types";

/**
 * Generate a unique ID for actions
 */
function generateActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Deep clone an action with a new ID
 */
function cloneAction(
  action: Action,
  offset: { x: number; y: number } = { x: 0, y: 0 }
): Action {
  return {
    ...action,
    id: generateActionId(),
    position: [action.position[0] + offset.x, action.position[1] + offset.y],
  };
}

export const createActionSlice: StateCreator<
  CanvasStore,
  [["zustand/immer", never]],
  [],
  ActionSlice
> = (set, get) => ({
  // Actions
  addAction: (action: Action) => {
    set((state) => {
      if (!state.workflow) return;

      state.workflow.actions.push(action);
      state.isDirty = true;
    });
    get().recordHistory(`Add action: ${action.type}`);
  },

  updateAction: (actionId: string, updates: Partial<Action>) => {
    set((state) => {
      if (!state.workflow) return;

      const index = state.workflow.actions.findIndex((a) => a.id === actionId);
      if (index !== -1) {
        state.workflow.actions[index] = {
          ...state.workflow.actions[index],
          ...updates,
        } as Action;
        state.isDirty = true;
      }
    });
    get().recordHistory(`Update action: ${actionId}`);
  },

  deleteAction: (actionId: string) => {
    set((state) => {
      if (!state.workflow) return;

      // Remove action
      state.workflow.actions = state.workflow.actions.filter(
        (a) => a.id !== actionId
      );

      // Remove connections
      delete state.workflow.connections[actionId];

      // Remove connections TO this action
      for (const sourceId of Object.keys(state.workflow.connections)) {
        const sourceConnections = state.workflow.connections[sourceId];
        if (!sourceConnections) continue;
        for (const type of Object.keys(sourceConnections)) {
          (sourceConnections[type as keyof typeof sourceConnections] as Connection[][]) = (sourceConnections[type as keyof typeof sourceConnections] as Connection[][])?.map((outputs: Connection[]) =>
            outputs.filter((conn: Connection) => conn.action !== actionId)
          );
        }
      }

      // Remove from selection
      state.selectedNodes = state.selectedNodes.filter((id) => id !== actionId);
      state.isDirty = true;
    });
    get().recordHistory(`Delete action: ${actionId}`);
  },

  deleteActions: (actionIds: string[]) => {
    set((state) => {
      if (!state.workflow) return;

      const idsSet = new Set(actionIds);

      // Remove actions
      state.workflow.actions = state.workflow.actions.filter(
        (a) => !idsSet.has(a.id)
      );

      // Remove connections
      for (const actionId of actionIds) {
        delete state.workflow.connections[actionId];
      }

      // Remove connections TO these actions
      for (const sourceId of Object.keys(state.workflow.connections)) {
        const sourceConnections = state.workflow.connections[sourceId];
        if (!sourceConnections) continue;
        for (const type of Object.keys(sourceConnections)) {
          (sourceConnections[type as keyof typeof sourceConnections] as Connection[][]) = (sourceConnections[type as keyof typeof sourceConnections] as Connection[][])?.map((outputs: Connection[]) =>
            outputs.filter((conn: Connection) => !idsSet.has(conn.action))
          );
        }
      }

      // Clear selection
      state.selectedNodes = state.selectedNodes.filter((id) => !idsSet.has(id));
      state.isDirty = true;
    });
    get().recordHistory(`Delete ${actionIds.length} actions`);
  },

  duplicateAction: (actionId: string, offset = { x: 50, y: 50 }) => {
    const action = get().getActionById(actionId);
    if (!action) return;

    const newAction = cloneAction(action, offset);
    get().addAction(newAction);
    get().selectNode(newAction.id, false);
  },

  moveAction: (actionId: string, position: [number, number]) => {
    get().updateAction(actionId, { position });
  },

  moveActions: (
    updates: { actionId: string; position: [number, number] }[]
  ) => {
    set((state) => {
      if (!state.workflow) return;

      for (const { actionId, position } of updates) {
        const index = state.workflow.actions.findIndex(
          (a) => a.id === actionId
        );
        if (index !== -1) {
          const action = state.workflow.actions[index];
          if (action) {
            action.position = position;
          }
        }
      }
      state.isDirty = true;
    });
    get().recordHistory(`Move ${updates.length} actions`);
  },

  getActionById: (actionId: string) => {
    const { workflow } = get();
    return workflow?.actions.find((a) => a.id === actionId);
  },

  findActionsByType: (type: string) => {
    const { workflow } = get();
    return workflow?.actions.filter((a) => a.type === type) || [];
  },
});
