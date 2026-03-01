/**
 * Canvas Sync Hook - Manages workflow <-> ReactFlow state synchronization
 *
 * Handles converting workflow data to ReactFlow nodes/edges and keeping
 * them in sync when the workflow changes externally.
 */

import { useEffect, useMemo, useRef } from "react";
import { Node, Edge, useNodesState, useEdgesState } from "@xyflow/react";
import { Workflow } from "@/lib/action-schema/action-types";
import { workflowToReactFlow } from "../canvas-utils";

export interface UseCanvasSyncResult {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onNodesChange: ReturnType<typeof useNodesState>[2];
  onEdgesChange: ReturnType<typeof useEdgesState>[2];
  /** Ref to mark changes as internal (prevents sync loop) */
  isInternalChangeRef: React.MutableRefObject<boolean>;
}

export function useCanvasSync(workflow: Workflow): UseCanvasSyncResult {
  // Convert workflow to React Flow format
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => workflowToReactFlow(workflow),
    [workflow]
  );

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialNodes as unknown as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialEdges as unknown as Edge[]
  );

  // Track if we initiated the last workflow change
  const isInternalChangeRef = useRef(false);
  const lastWorkflowRef = useRef(workflow);

  // Create a stable key for the workflow to detect actual content changes
  // This prevents infinite loops from object reference changes
  const workflowKey = useMemo(() => {
    const actionIds = workflow.actions
      .map((a) => a.id)
      .sort()
      .join(",");
    const connectionKeys = Object.entries(workflow.connections || {})
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join(";");
    return `${workflow.id}|${actionIds}|${connectionKeys}`;
  }, [workflow.id, workflow.actions, workflow.connections]);

  // Update nodes/edges when workflow changes externally
  useEffect(() => {
    // Skip if we initiated this change
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      lastWorkflowRef.current = workflow;
      return;
    }

    const { nodes: newNodes, edges: newEdges } = workflowToReactFlow(workflow);

    setNodes(newNodes as unknown as Node[]);
    setEdges(newEdges as unknown as Edge[]);
    lastWorkflowRef.current = workflow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey]); // Use stable key instead of object references

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    isInternalChangeRef,
  };
}
