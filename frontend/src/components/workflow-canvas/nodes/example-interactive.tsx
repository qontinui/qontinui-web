import React, { useCallback } from "react";
import {
  Node,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlow,
} from "@xyflow/react";
import { NODE_TYPES } from "./node-registry";
import { BaseNodeData } from "./BaseNode";
import {
  interactiveWorkflowNodes,
  interactiveWorkflowEdges,
} from "./example-mock-data";

function addClickHandler(
  nodes: Node<BaseNodeData>[],
  handler: (nodeId: string) => void
): Node<BaseNodeData>[] {
  return nodes.map((node) => ({
    ...node,
    data: { ...node.data, onNodeClick: handler },
  }));
}

export function InteractiveWorkflowExample() {
  const handleNodeClick = useCallback((nodeId: string) => {
    console.log("Node clicked:", nodeId);
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BaseNodeData>>(
    addClickHandler(interactiveWorkflowNodes, handleNodeClick)
  );
  const [edges, , onEdgesChange] = useEdgesState(interactiveWorkflowEdges);

  const executeWorkflow = useCallback(async () => {
    const nodeIds = ["1", "2", "3"];

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];

      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...(node.data as BaseNodeData),
                  executionState: "running" as const,
                },
              }
            : node
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...(node.data as BaseNodeData),
                  executionState: "completed" as const,
                },
              }
            : node
        )
      );
    }
  }, [setNodes]);

  const resetWorkflow = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...(node.data as BaseNodeData),
          executionState: "idle" as const,
        },
      }))
    );
  }, [setNodes]);

  return (
    <div>
      <div style={{ marginBottom: "10px" }}>
        <button
          onClick={executeWorkflow}
          style={{
            padding: "8px 16px",
            marginRight: "8px",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Execute Workflow
        </button>
        <button
          onClick={resetWorkflow}
          style={{
            padding: "8px 16px",
            background: "#6b7280",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>
      <div style={{ width: "100%", height: "600px" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
