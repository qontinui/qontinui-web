import { Node, Edge } from "@xyflow/react";
import { Action, ActionType } from "@/lib/action-schema/action-types";
import { BaseNodeData } from "./BaseNode";

export const simpleWorkflowNodes: Node<BaseNodeData>[] = [
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

export const simpleWorkflowEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", target: "3" },
];

export const conditionalWorkflowNodes: Node<BaseNodeData>[] = [
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

export const conditionalWorkflowEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", sourceHandle: "true", target: "3" },
  { id: "e2-4", source: "2", sourceHandle: "false", target: "4" },
];

export const loopWorkflowNodes: Node<BaseNodeData>[] = [
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

export const loopWorkflowEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", sourceHandle: "loop", target: "3" },
  { id: "e3-2", source: "3", target: "2" },
  { id: "e2-4", source: "2", sourceHandle: "main", target: "4" },
];

export const interactiveWorkflowNodes: Node<BaseNodeData>[] = [
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
        config: { text: "example" } as Action["config"],
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
        config: { region: { x: 0, y: 0, width: 1920, height: 1080 } },
        position: [500, 100],
      },
      executionState: "idle",
    },
  },
];

export const interactiveWorkflowEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", target: "3" },
];

interface NodeCategory {
  name: string;
  nodes: { type: string; x: number; y: number }[];
}

export const showcaseCategories: NodeCategory[] = [
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

export function buildShowcaseNodes(): Node<BaseNodeData>[] {
  return showcaseCategories.flatMap((category, catIndex) =>
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
}
