import { StateNode } from "@/components/state-node";
import { TransitionNode } from "@/components/transition-node";
import { TransitionEdge } from "@/components/transition-edge";
import type { NodeTypes } from "@xyflow/react";

export const nodeTypes: NodeTypes = {
  stateNode: StateNode,
  transitionNode: TransitionNode,
};

export const edgeTypes = {
  transitionEdge: TransitionEdge,
};
