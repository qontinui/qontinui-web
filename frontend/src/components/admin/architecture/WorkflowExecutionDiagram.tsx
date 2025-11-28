"use client";

/**
 * Interactive Workflow Execution Pipeline Diagram
 *
 * Visual representation of the complete workflow execution pipeline from design to runtime
 */

import { useState } from "react";

interface WorkflowNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  type:
    | "building"
    | "validation"
    | "layout"
    | "export"
    | "mock"
    | "runner"
    | "graph"
    | "state"
    | "action";
  description: string;
}

interface WorkflowConnection {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

const nodes: WorkflowNode[] = [
  // 1. WORKFLOW BUILDING (Blue)
  {
    id: "workflow-canvas",
    name: "WorkflowCanvas",
    x: 30,
    y: 30,
    width: 140,
    height: 65,
    color: "#3B82F6",
    type: "building",
    description:
      "WorkflowCanvas.tsx - React Flow-based visual editor with drag-and-drop, keyboard shortcuts (Ctrl+L auto-layout)",
  },
  {
    id: "reactflow",
    name: "@xyflow/react",
    x: 190,
    y: 30,
    width: 140,
    height: 65,
    color: "#3B82F6",
    type: "building",
    description:
      "@xyflow/react - Interactive node-based graph visualization with 37 registered action types",
  },
  {
    id: "node-registry",
    name: "Node Registry",
    x: 350,
    y: 30,
    width: 140,
    height: 65,
    color: "#3B82F6",
    type: "building",
    description:
      "node-registry.ts - Maps 37 action types to visual components (IF, LOOP, SWITCH, TRY_CATCH, BREAK, CONTINUE + standard actions)",
  },

  // 2. VALIDATION (Orange)
  {
    id: "dependency-analyzer",
    name: "Dependency Analyzer",
    x: 30,
    y: 125,
    width: 130,
    height: 60,
    color: "#F59E0B",
    type: "validation",
    description:
      "workflow-dependency-analyzer.ts - DFS cycle detection, topological sort, in-degree/out-degree calculation, 5-min cache",
  },
  {
    id: "cycle-detection",
    name: "Cycle Detection",
    x: 180,
    y: 125,
    width: 130,
    height: 60,
    color: "#F59E0B",
    type: "validation",
    description:
      "DFS with recursion stack - Detects circular dependencies, allows LOOP actions, reports all cycles",
  },
  {
    id: "validation-rules",
    name: "Validation Rules",
    x: 330,
    y: 125,
    width: 130,
    height: 60,
    color: "#F59E0B",
    type: "validation",
    description:
      "canvas-utils.ts - Self-connection prevention, duplicate detection, output count validation, wouldCreateCycle check",
  },

  // 3. LAYOUT (Purple)
  {
    id: "dagre-layout",
    name: "Dagre Layout",
    x: 30,
    y: 215,
    width: 130,
    height: 60,
    color: "#8B5CF6",
    type: "layout",
    description:
      "layout-utils.ts - Hierarchical graph layout (TB/LR/BT/RL), node spacing (50px), rank separation (100px)",
  },
  {
    id: "auto-layout",
    name: "Auto-Layout",
    x: 180,
    y: 215,
    width: 130,
    height: 60,
    color: "#8B5CF6",
    type: "layout",
    description:
      "auto-layout-integration.ts - 5 styles (hierarchical/horizontal/tree/force-directed/circular), quality metrics, best style detection",
  },

  // 4. CONFIG EXPORT (Green)
  {
    id: "export-schema",
    name: "Export Schema",
    x: 30,
    y: 305,
    width: 120,
    height: 65,
    color: "#10B981",
    type: "export",
    description:
      "export-schema.ts - Version 2.0.0 JSON structure, QontinuiConfig interface with workflows/states/transitions/images",
  },
  {
    id: "workflow-structure",
    name: "Workflow Graph",
    x: 170,
    y: 305,
    width: 120,
    height: 65,
    color: "#10B981",
    type: "export",
    description:
      "Graph format with actions[], connections{}, metadata (view mode, timestamps), nested connection structure",
  },
  {
    id: "connection-graph",
    name: "Connection Graph",
    x: 310,
    y: 305,
    width: 120,
    height: 65,
    color: "#10B981",
    type: "export",
    description:
      "ActionOutputs: main/success/error/parallel/true/false/case_N paths, Connection[action, type, index]",
  },
  {
    id: "state-data",
    name: "State & Transitions",
    x: 450,
    y: 305,
    width: 120,
    height: 65,
    color: "#10B981",
    type: "export",
    description:
      "States with elements/min_elements/transitions, Transition with from/to/action_type/trigger_element/probability",
  },

  // 5A. MOCK EXECUTION (Pink)
  {
    id: "mock-execution",
    name: "Mock Executor",
    x: 30,
    y: 400,
    width: 130,
    height: 65,
    color: "#EC4899",
    type: "mock",
    description:
      "mock_executor.py - Simulated execution with captured screenshots, pattern matching, deterministic state transitions, no real I/O",
  },
  {
    id: "integration-testing",
    name: "Integration Testing",
    x: 180,
    y: 400,
    width: 130,
    height: 65,
    color: "#EC4899",
    type: "mock",
    description:
      "useMockExecution.ts + Integration Testing Service - Fast workflow validation before deployment",
  },

  // 5B. QONTINUI-RUNNER (Teal)
  {
    id: "qontinui-runner",
    name: "qontinui-runner",
    x: 330,
    y: 400,
    width: 120,
    height: 65,
    color: "#14B8A6",
    type: "runner",
    description:
      "Tauri desktop app - React frontend + Rust backend, native file picker, real-time monitoring, WebSocket event streaming",
  },
  {
    id: "python-bridge",
    name: "Python Bridge",
    x: 470,
    y: 400,
    width: 120,
    height: 65,
    color: "#14B8A6",
    type: "runner",
    description:
      "qontinui_executor.py - Spawns Python subprocess, JSON command/event protocol, EventTranslator, ExecutionTree tracking",
  },

  // 6. GRAPH EXECUTION ENGINE (Yellow)
  {
    id: "graph-executor",
    name: "GraphExecutor",
    x: 30,
    y: 495,
    width: 130,
    height: 65,
    color: "#EAB308",
    type: "graph",
    description:
      "graph_executor.py - Orchestrates execution, manages state (pending/executing/completed/failed), execution hooks, validates before run",
  },
  {
    id: "graph-traverser",
    name: "GraphTraverser",
    x: 180,
    y: 495,
    width: 130,
    height: 65,
    color: "#EAB308",
    type: "graph",
    description:
      "graph_traverser.py - BFS traversal, finds entry/exit points, DFS cycle detection, topological sort (Kahn's algorithm)",
  },
  {
    id: "connection-router",
    name: "ConnectionRouter",
    x: 330,
    y: 495,
    width: 130,
    height: 65,
    color: "#EAB308",
    type: "graph",
    description:
      "connection_router.py - Routes execution based on results (IF/SWITCH/LOOP/TRY_CATCH), handles sequential branching for GUI automation",
  },

  // 7. STATE MACHINE NAVIGATION (Cyan)
  {
    id: "state-detector",
    name: "State Detector",
    x: 30,
    y: 590,
    width: 130,
    height: 65,
    color: "#06B6D4",
    type: "state",
    description:
      "state_detector.py - Visual pattern matching, check_for_active_states (fast), search_all_images (O(n*m)), async parallel discovery",
  },
  {
    id: "path-finder",
    name: "Path Finder",
    x: 180,
    y: 590,
    width: 130,
    height: 65,
    color: "#06B6D4",
    type: "state",
    description:
      "hybrid_path_finder.py - 4 strategies (BFS shortest, A* optimal, DFS all paths, most reliable), thread-safe cache",
  },
  {
    id: "transition-executor",
    name: "Transition Executor",
    x: 330,
    y: 590,
    width: 130,
    height: 65,
    color: "#06B6D4",
    type: "state",
    description:
      "transition_executor.py - Executes outgoing → activates states → executes incoming → updates visibility → syncs memory",
  },
  {
    id: "state-manager",
    name: "State Manager",
    x: 480,
    y: 590,
    width: 130,
    height: 65,
    color: "#06B6D4",
    type: "state",
    description:
      "manager.py - Evidence accumulation (0.75 activate, 0.3 deactivate), 0.95 decay per cycle, pytransitions integration",
  },

  // 8. ACTION EXECUTION (Lime)
  {
    id: "delegating-executor",
    name: "DelegatingExecutor",
    x: 30,
    y: 685,
    width: 130,
    height: 65,
    color: "#84CC16",
    type: "action",
    description:
      "delegating_executor.py - Command pattern with registry, retry logic, pause management, event emission, context management",
  },
  {
    id: "action-executors",
    name: "Specialized Executors",
    x: 180,
    y: 685,
    width: 130,
    height: 65,
    color: "#84CC16",
    type: "action",
    description:
      "Mouse, Keyboard, Vision, ControlFlow, DataOps, Navigation, Utility executors - Registry-based delegation",
  },
  {
    id: "target-resolver",
    name: "Target Resolver",
    x: 330,
    y: 685,
    width: 130,
    height: 65,
    color: "#84CC16",
    type: "action",
    description:
      "target_resolver.py - ImageTarget (pattern matching), CoordinatesTarget, RegionTarget, LastFindResultTarget, cascade options",
  },
  {
    id: "hal-cv",
    name: "HAL & CV",
    x: 480,
    y: 685,
    width: 130,
    height: 65,
    color: "#84CC16",
    type: "action",
    description:
      "wrappers/ - Brobot pattern (mock/real), OpenCV template matching, OCR (EasyOCR/Paddle/Tesseract), mouse/keyboard HAL",
  },
];

const connections: WorkflowConnection[] = [
  // Building to Validation
  { from: "workflow-canvas", to: "dependency-analyzer", label: "validate" },
  { from: "reactflow", to: "dependency-analyzer", label: "graph" },
  { from: "node-registry", to: "validation-rules", label: "types" },

  // Validation to Layout
  { from: "dependency-analyzer", to: "dagre-layout", label: "topology" },
  { from: "cycle-detection", to: "dagre-layout", label: "valid" },

  // Layout to Export
  { from: "dagre-layout", to: "export-schema", label: "positions" },
  { from: "auto-layout", to: "export-schema", label: "layout" },

  // Export connections
  { from: "export-schema", to: "workflow-structure", label: "v2.0.0" },
  { from: "workflow-structure", to: "connection-graph", label: "graph" },
  { from: "workflow-structure", to: "state-data", label: "states" },

  // Export to Mock
  { from: "connection-graph", to: "mock-execution", label: "config" },
  { from: "state-data", to: "mock-execution", label: "states" },
  { from: "mock-execution", to: "integration-testing", label: "simulate" },

  // Export to Runner
  { from: "connection-graph", to: "qontinui-runner", label: "config" },
  { from: "state-data", to: "qontinui-runner", label: "states" },
  { from: "qontinui-runner", to: "python-bridge", label: "IPC" },

  // Mock to Graph
  {
    from: "integration-testing",
    to: "graph-executor",
    label: "run",
    dashed: true,
  },

  // Runner to Graph
  { from: "python-bridge", to: "graph-executor", label: "execute" },

  // Graph Engine Internal
  { from: "graph-executor", to: "graph-traverser", label: "traverse" },
  { from: "graph-traverser", to: "connection-router", label: "route" },
  // Graph to State Machine
  { from: "connection-router", to: "state-detector", label: "verify" },
  { from: "connection-router", to: "path-finder", label: "navigate" },

  // State Machine Internal
  { from: "state-detector", to: "path-finder", label: "current" },
  { from: "path-finder", to: "transition-executor", label: "path" },
  { from: "transition-executor", to: "state-manager", label: "update" },

  // State Machine to Action
  { from: "transition-executor", to: "delegating-executor", label: "execute" },
  { from: "state-manager", to: "delegating-executor", label: "context" },

  // Action Execution Internal
  { from: "delegating-executor", to: "action-executors", label: "delegate" },
  { from: "action-executors", to: "target-resolver", label: "resolve" },
  { from: "target-resolver", to: "hal-cv", label: "match" },

  // Feedback Loops
  { from: "hal-cv", to: "connection-router", label: "result", dashed: true },
  {
    from: "state-manager",
    to: "state-detector",
    label: "verify",
    dashed: true,
  },
  {
    from: "python-bridge",
    to: "qontinui-runner",
    label: "events",
    dashed: true,
  },
];

export function WorkflowExecutionDiagram() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const getNodeColor = (type: WorkflowNode["type"]) => {
    switch (type) {
      case "building":
        return { main: "#3B82F6", hover: "#2563EB" };
      case "validation":
        return { main: "#F59E0B", hover: "#D97706" };
      case "layout":
        return { main: "#8B5CF6", hover: "#7C3AED" };
      case "export":
        return { main: "#10B981", hover: "#059669" };
      case "mock":
        return { main: "#EC4899", hover: "#DB2777" };
      case "runner":
        return { main: "#14B8A6", hover: "#0D9488" };
      case "graph":
        return { main: "#EAB308", hover: "#CA8A04" };
      case "state":
        return { main: "#06B6D4", hover: "#0891B2" };
      case "action":
        return { main: "#84CC16", hover: "#65A30D" };
    }
  };

  const isConnectionHighlighted = (conn: WorkflowConnection) => {
    if (!hoveredNode && !selectedNode) return false;
    const activeNode = hoveredNode || selectedNode;
    return conn.from === activeNode || conn.to === activeNode;
  };

  const isNodeDimmed = (nodeId: string) => {
    const active = hoveredNode || selectedNode;
    if (!active || active === nodeId) return false;

    const relatedNodes = connections
      .filter((c) => c.from === active || c.to === active)
      .flatMap((c) => [c.from, c.to]);

    return !relatedNodes.includes(nodeId);
  };

  return (
    <div className="w-full h-full min-h-[850px] flex flex-col">
      {/* Legend */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-4 text-sm mb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#3B82F6" }}
            />
            <span>Building</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#F59E0B" }}
            />
            <span>Validation</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#8B5CF6" }}
            />
            <span>Layout</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#10B981" }}
            />
            <span>Export</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#EC4899" }}
            />
            <span>Mock Execution</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#14B8A6" }}
            />
            <span>Runner</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#EAB308" }}
            />
            <span>Graph Engine</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#06B6D4" }}
            />
            <span>State Machine</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: "#84CC16" }}
            />
            <span>Action Execution</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Complete workflow execution pipeline from design to runtime. Dashed
          lines indicate feedback loops or async paths. Click nodes for details.
        </p>
      </div>

      {/* SVG Diagram */}
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 640 790" className="w-full h-full max-h-[850px]">
          <defs>
            <filter id="shadow-workflow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
            </filter>
            <marker
              id="arrowhead-workflow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="#64748B" />
            </marker>
            <marker
              id="arrowhead-active-workflow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 10 3, 0 6" fill="#3B82F6" />
            </marker>
          </defs>

          {/* Connections */}
          <g>
            {connections.map((conn, idx) => {
              const fromNode = nodes.find((n) => n.id === conn.from);
              const toNode = nodes.find((n) => n.id === conn.to);
              if (!fromNode || !toNode) return null;

              const isHighlighted = isConnectionHighlighted(conn);
              const fromX = fromNode.x + fromNode.width / 2;
              const fromY = fromNode.y + fromNode.height;
              const toX = toNode.x + toNode.width / 2;
              const toY = toNode.y;

              return (
                <g key={idx}>
                  <line
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                    stroke={isHighlighted ? "#3B82F6" : "#64748B"}
                    strokeWidth={isHighlighted ? 3 : 2}
                    strokeDasharray={conn.dashed ? "5,5" : undefined}
                    markerEnd={
                      isHighlighted
                        ? "url(#arrowhead-active-workflow)"
                        : "url(#arrowhead-workflow)"
                    }
                    opacity={hoveredNode && !isHighlighted ? 0.3 : 1}
                  />
                  {conn.label && (
                    <text
                      x={(fromX + toX) / 2}
                      y={(fromY + toY) / 2}
                      fill={isHighlighted ? "#3B82F6" : "#64748B"}
                      fontSize="10"
                      textAnchor="middle"
                      opacity={hoveredNode && !isHighlighted ? 0.3 : 1}
                    >
                      {conn.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => {
              const colors = getNodeColor(node.type);
              const isSelected = selectedNode === node.id;
              const isHovered = hoveredNode === node.id;
              const isDimmed = isNodeDimmed(node.id);

              return (
                <g
                  key={node.id}
                  onClick={() =>
                    setSelectedNode(node.id === selectedNode ? null : node.id)
                  }
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className="cursor-pointer"
                  style={{ opacity: isDimmed ? 0.3 : 1 }}
                >
                  {(isSelected || isHovered) && (
                    <rect
                      x={node.x - 4}
                      y={node.y - 4}
                      width={node.width + 8}
                      height={node.height + 8}
                      rx="10"
                      fill="none"
                      stroke={colors.main}
                      strokeWidth="3"
                      opacity="0.5"
                    />
                  )}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx="6"
                    fill={isHovered ? colors.hover : colors.main}
                    filter="url(#shadow-workflow)"
                  />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 - 5}
                    fill="white"
                    fontSize="13"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {node.name}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + node.height / 2 + 12}
                    fill="white"
                    fontSize="9"
                    opacity="0.8"
                    textAnchor="middle"
                  >
                    {node.type}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Selected Node Details */}
      {selectedNode && (
        <div className="mt-4 p-4 bg-muted rounded-lg">
          <h3 className="font-semibold mb-2">
            {nodes.find((n) => n.id === selectedNode)?.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {nodes.find((n) => n.id === selectedNode)?.description}
          </p>
        </div>
      )}
    </div>
  );
}
