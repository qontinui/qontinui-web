/**
 * useItemManagement Hook
 *
 * Provides unified CRUD operations for workflows.
 * All items are now Workflows - sequential workflows are linear graphs.
 */

import { useCallback, useMemo } from "react";
import { useAutomation } from "@/contexts/automation-context";
import type { LibraryItem } from "../types";
import type { Workflow } from "@/lib/action-schema/action-types";

interface CreateWorkflowOptions {
  viewMode?: "sequential" | "graph";
  category?: string;
  name?: string;
  description?: string;
}

export function useItemManagement() {
  const { workflows, addWorkflow, updateWorkflow, deleteWorkflow } =
    useAutomation();

  /**
   * All items are workflows
   */
  const allItems = useMemo<LibraryItem[]>(() => {
    return workflows;
  }, [workflows]);

  /**
   * Find a workflow by ID
   */
  const findItem = useCallback(
    (id: string): LibraryItem | null => {
      return workflows.find((w) => w.id === id) || null;
    },
    [workflows]
  );

  /**
   * Update a workflow
   */
  const updateItem = useCallback(
    (item: LibraryItem) => {
      updateWorkflow(item);
    },
    [updateWorkflow]
  );

  /**
   * Delete a workflow
   */
  const deleteItem = useCallback(
    (item: LibraryItem) => {
      deleteWorkflow(item.id);
    },
    [deleteWorkflow]
  );

  /**
   * Create a new sequential workflow (linear graph)
   */
  const createSequential = useCallback(
    (category: string = "Main", name?: string): Workflow => {
      const newWorkflow: Workflow = {
        id: `workflow-${Date.now()}`,
        name: name || "New Sequential Workflow",
        description: "",
        category,
        format: "graph",
        version: "1.0.0",
        actions: [],
        connections: {},
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          viewMode: "sequential",
        },
      };
      addWorkflow(newWorkflow);
      return newWorkflow;
    },
    [addWorkflow]
  );

  /**
   * Create a new graph workflow
   */
  const createGraph = useCallback(
    (category: string = "Main", name?: string): Workflow => {
      const newWorkflow: Workflow = {
        id: `workflow-${Date.now()}`,
        name: name || "New Graph Workflow",
        description: "",
        category,
        format: "graph",
        version: "1.0.0",
        actions: [],
        connections: {},
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          viewMode: "graph",
        },
      };
      addWorkflow(newWorkflow);
      return newWorkflow;
    },
    [addWorkflow]
  );

  /**
   * Create a new workflow with custom options
   */
  const createWorkflow = useCallback(
    (options: CreateWorkflowOptions = {}): Workflow => {
      const { viewMode = "sequential", category = "Main", name } = options;

      if (viewMode === "sequential") {
        return createSequential(category, name);
      } else {
        return createGraph(category, name);
      }
    },
    [createSequential, createGraph]
  );

  return {
    // Collections
    allItems,
    workflows,

    // Queries
    findItem,

    // Mutations
    updateItem,
    deleteItem,
    createSequential,
    createGraph,
    createWorkflow,

    // Raw workflow functions
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
  };
}
