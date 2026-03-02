import React, { useCallback } from "react";
import {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ReactFlow,
} from "@xyflow/react";
import { NODE_TYPES } from "./node-registry";
import "@xyflow/react/dist/style.css";
import "./nodes.css";
import {
  simpleWorkflowNodes,
  simpleWorkflowEdges,
  conditionalWorkflowNodes,
  conditionalWorkflowEdges,
  loopWorkflowNodes,
  loopWorkflowEdges,
  buildShowcaseNodes,
} from "./example-mock-data";

export { InteractiveWorkflowExample } from "./example-interactive";

export function SimpleWorkflowExample() {
  const [nodes, , onNodesChange] = useNodesState(simpleWorkflowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(simpleWorkflowEdges);

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

export function ConditionalWorkflowExample() {
  const [nodes, , onNodesChange] = useNodesState(conditionalWorkflowNodes);
  const [edges, , onEdgesChange] = useEdgesState(conditionalWorkflowEdges);

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

export function LoopWorkflowExample() {
  const [nodes, , onNodesChange] = useNodesState(loopWorkflowNodes);
  const [edges, , onEdgesChange] = useEdgesState(loopWorkflowEdges);

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

export function AllNodeTypesShowcase() {
  const allNodes = buildShowcaseNodes();

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
