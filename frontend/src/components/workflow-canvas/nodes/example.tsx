/**
 * Example Usage - Workflow Canvas Nodes
 *
 * Examples demonstrating how to use the custom node components
 * with React Flow for building workflow visualizations.
 */

import React, { useCallback } from "react";
import {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ReactFlow,
} from "@xyflow/react";
import { Action, ActionType } from "@/lib/action-schema/action-types";
import { NODE_TYPES } from "./node-registry";
import { BaseNodeData } from "./BaseNode";
import "@xyflow/react/dist/style.css";
import "./nodes.css";

/**
 * Example 1: Simple Linear Workflow
 */
export function SimpleWorkflowExample() {
  const initialNodes: Node<BaseNodeData>[] = [
    {
      id: "1",
      type: "CLICK",
      position: { x: 100, y: 100 },
      data: {
        action: {
          id: "1",
          type: "CLICK",
          config: {} as Action["config"],
          position: [100, 100],
        },
        executionState: "idle",
      },
    },
    {
      id: "2",
      type: "TYPE",
      position: { x: 300, y: 100 },
      data: {
        action: {
          id: "2",
          type: "TYPE",
          config: {
            text: "username@example.com",
          },
          position: [300, 100],
        },
        executionState: "idle",
      },
    },
    {
      id: "3",
      type: "SCREENSHOT",
      position: { x: 500, y: 100 },
      data: {
        action: {
          id: "3",
          type: "SCREENSHOT",
          config: {
            region: "fullscreen" as unknown,
          } as Action["config"],
          position: [500, 100],
        },
        executionState: "idle",
      },
    },
  ];

  const initialEdges: Edge[] = [
    { id: "e1-2", source: "1", target: "2" },
    { id: "e2-3", source: "2", target: "3" },
  ];

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div style={{ width: "100%", height: "600px" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

/**
 * Example 2: Conditional Workflow with IF Node
 */
export function ConditionalWorkflowExample() {
  const initialNodes: Node<BaseNodeData>[] = [
    {
      id: "1",
      type: "FIND",
      position: { x: 100, y: 150 },
      data: {
        action: {
          id: "1",
          type: "FIND",
          config: {} as Action["config"],
          position: [100, 150],
        },
      },
    },
    {
      id: "2",
      type: "IF",
      position: { x: 300, y: 150 },
      data: {
        action: {
          id: "2",
          type: "IF",
          config: {
            condition: {
              type: "image_exists" as unknown,
              imageId: "success-icon",
            },
            thenActions: ["3"],
            elseActions: ["4"],
          } as Action["config"],
          position: [300, 150],
        },
      },
    },
    {
      id: "3",
      type: "SCREENSHOT",
      position: { x: 500, y: 50 },
      data: {
        action: {
          id: "3",
          type: "SCREENSHOT",
          config: {
            region: "fullscreen" as unknown,
          } as Action["config"],
          position: [500, 50],
        },
      },
    },
    {
      id: "4",
      type: "SCREENSHOT",
      position: { x: 500, y: 250 },
      data: {
        action: {
          id: "4",
          type: "SCREENSHOT",
          config: {
            region: "fullscreen" as unknown,
          } as Action["config"],
          position: [500, 250],
        },
      },
    },
  ];

  const initialEdges: Edge[] = [
    { id: "e1-2", source: "1", target: "2" },
    { id: "e2-3", source: "2", sourceHandle: "true", target: "3" },
    { id: "e2-4", source: "2", sourceHandle: "false", target: "4" },
  ];

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
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
  );
}

/**
 * Example 3: Loop Workflow
 */
export function LoopWorkflowExample() {
  const initialNodes: Node<BaseNodeData>[] = [
    {
      id: "1",
      type: "SET_VARIABLE",
      position: { x: 100, y: 150 },
      data: {
        action: {
          id: "1",
          type: "SET_VARIABLE",
          config: {
            variableName: "counter",
            value: 0,
            scope: "local",
          },
          position: [100, 150],
        },
      },
    },
    {
      id: "2",
      type: "LOOP",
      position: { x: 300, y: 150 },
      data: {
        action: {
          id: "2",
          type: "LOOP",
          config: {
            loopType: "FOR",
            iterations: 5,
            iteratorVariable: "i",
            actions: ["3"],
          },
          position: [300, 150],
        },
      },
    },
    {
      id: "3",
      type: "CLICK",
      position: { x: 500, y: 100 },
      data: {
        action: {
          id: "3",
          type: "CLICK",
          config: {} as Action["config"],
          position: [500, 100],
        },
      },
    },
    {
      id: "4",
      type: "SCREENSHOT",
      position: { x: 500, y: 200 },
      data: {
        action: {
          id: "4",
          type: "SCREENSHOT",
          config: {
            region: "fullscreen" as unknown,
          } as Action["config"],
          position: [500, 200],
        },
      },
    },
  ];

  const initialEdges: Edge[] = [
    { id: "e1-2", source: "1", target: "2" },
    { id: "e2-3", source: "2", sourceHandle: "loop", target: "3" },
    { id: "e3-2", source: "3", target: "2" }, // Loop back
    { id: "e2-4", source: "2", sourceHandle: "main", target: "4" }, // Exit loop
  ];

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
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
  );
}

/**
 * Example 4: Interactive Workflow with Execution States
 */
export function InteractiveWorkflowExample() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BaseNodeData>>([
    {
      id: "1",
      type: "CLICK",
      position: { x: 100, y: 100 },
      data: {
        action: {
          id: "1",
          type: "CLICK",
          config: {} as Action["config"],
          position: [100, 100],
        },
        executionState: "idle",
        onNodeClick: handleNodeClick,
      },
    },
    {
      id: "2",
      type: "TYPE",
      position: { x: 300, y: 100 },
      data: {
        action: {
          id: "2",
          type: "TYPE",
          config: { text: "example" } as Action["config"],
          position: [300, 100],
        },
        executionState: "idle",
        onNodeClick: handleNodeClick,
      },
    },
    {
      id: "3",
      type: "SCREENSHOT",
      position: { x: 500, y: 100 },
      data: {
        action: {
          id: "3",
          type: "SCREENSHOT",
          config: { region: { x: 0, y: 0, width: 1920, height: 1080 } },
          position: [500, 100],
        },
        executionState: "idle",
        onNodeClick: handleNodeClick,
      },
    },
  ]);

  const [edges, , onEdgesChange] = useEdgesState([
    { id: "e1-2", source: "1", target: "2" },
    { id: "e2-3", source: "2", target: "3" },
  ]);

  function handleNodeClick(nodeId: string) {
    console.log("Node clicked:", nodeId);
  }

  const executeWorkflow = useCallback(async () => {
    const nodeIds = ["1", "2", "3"];

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];

      // Set running state
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

      // Simulate execution
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Set completed state
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

/**
 * Example 5: All Node Types Showcase
 */
export function AllNodeTypesShowcase() {
  const categories = [
    {
      name: "Control Flow",
      nodes: [
        { type: "IF", x: 0, y: 0 },
        { type: "LOOP", x: 250, y: 0 },
        { type: "SWITCH", x: 500, y: 0 },
        { type: "TRY_CATCH", x: 750, y: 0 },
        { type: "BREAK", x: 1000, y: 0 },
        { type: "CONTINUE", x: 1200, y: 0 },
      ],
    },
    {
      name: "GUI Actions",
      nodes: [
        { type: "CLICK", x: 0, y: 150 },
        { type: "TYPE", x: 200, y: 150 },
        { type: "FIND", x: 400, y: 150 },
        { type: "VANISH", x: 600, y: 150 },
        { type: "SCREENSHOT", x: 800, y: 150 },
      ],
    },
    {
      name: "Data Operations",
      nodes: [
        { type: "SET_VARIABLE", x: 0, y: 300 },
        { type: "FILTER", x: 250, y: 300 },
        { type: "MAP", x: 500, y: 300 },
        { type: "SORT", x: 750, y: 300 },
      ],
    },
  ];

  const allNodes = categories.flatMap((category, catIndex) =>
    category.nodes.map((nodeInfo, nodeIndex) => ({
      id: `${catIndex}-${nodeIndex}`,
      type: nodeInfo.type,
      position: { x: nodeInfo.x, y: nodeInfo.y },
      data: {
        action: {
          id: `${catIndex}-${nodeIndex}`,
          type: nodeInfo.type as ActionType,
          config: {} as Action["config"],
          position: [nodeInfo.x, nodeInfo.y],
        },
        executionState: "idle" as const,
      },
    }))
  ) as Node<BaseNodeData>[];

  return (
    <div style={{ width: "100%", height: "800px" }}>
      <h2 style={{ marginBottom: "10px" }}>All Node Types</h2>
      <ReactFlow nodes={allNodes} edges={[]} nodeTypes={NODE_TYPES} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
