/**
 * Auto-layout algorithm for graph workflows
 *
 * Positions actions in a graph workflow to create a clear, readable layout.
 * Handles branches, merges, and complex control flow structures.
 */

import { Action } from "../action-schema/action-types";
import { Connections } from "../action-schema/action-types";

/**
 * Layout options
 */
export interface LayoutOptions {
  /** Horizontal spacing between depth levels */
  horizontalSpacing?: number;

  /** Vertical spacing between nodes at same depth */
  verticalSpacing?: number;

  /** Starting X position */
  startX?: number;

  /** Starting Y position */
  startY?: number;

  /** Node width (for collision detection) */
  nodeWidth?: number;

  /** Node height (for collision detection) */
  nodeHeight?: number;

  /** Extra vertical offset for branches */
  branchOffset?: number;
}

/**
 * Layout node with position metadata
 */
interface LayoutNode {
  action: Action;
  depth: number;
  verticalIndex: number;
  children: string[];
  parents: string[];
}

/**
 * Auto-layout algorithm for graph workflows
 *
 * Positions nodes using a hierarchical layout algorithm:
 * 1. Calculate depth for each node (topological sort)
 * 2. Group nodes by depth
 * 3. Assign X coordinates based on depth
 * 4. Assign Y coordinates to minimize crossings
 * 5. Handle branches with vertical offsets
 */
export class AutoLayout {
  private readonly options: Required<LayoutOptions>;
  private nodes: Map<string, LayoutNode> = new Map();
  private connections: Connections;

  constructor(options: LayoutOptions = {}) {
    this.options = {
      horizontalSpacing: options.horizontalSpacing ?? 200,
      verticalSpacing: options.verticalSpacing ?? 150,
      startX: options.startX ?? 100,
      startY: options.startY ?? 100,
      nodeWidth: options.nodeWidth ?? 180,
      nodeHeight: options.nodeHeight ?? 80,
      branchOffset: options.branchOffset ?? 50,
    };
    this.connections = {};
  }

  /**
   * Calculate layout positions for all actions
   *
   * @param actions - Actions to layout
   * @param connections - Connections between actions
   *
   * @example
   * const layout = new AutoLayout();
   * layout.layout(actions, connections);
   * // Actions now have updated positions
   */
  layout(actions: Action[], connections: Connections): void {
    if (actions.length === 0) return;

    this.connections = connections;
    this.nodes.clear();

    // Build node graph
    this.buildNodeGraph(actions);

    // Calculate depths (topological order)
    this.calculateDepths(actions);

    // Group by depth
    const depthGroups = this.groupByDepth();

    // Assign positions
    this.assignPositions(depthGroups);

    // Handle branches
    this.adjustBranches();

    // Apply positions to actions
    this.applyPositions(actions);
  }

  /**
   * Build node graph with parent/child relationships
   */
  private buildNodeGraph(actions: Action[]): void {
    // Initialize nodes
    actions.forEach((action) => {
      this.nodes.set(action.id, {
        action,
        depth: 0,
        verticalIndex: 0,
        children: [],
        parents: [],
      });
    });

    // Build relationships
    Object.entries(this.connections).forEach(([sourceId, outputs]) => {
      const sourceNode = this.nodes.get(sourceId);
      if (!sourceNode) return;

      ["main", "error", "success", "parallel"].forEach((type) => {
        const conns = outputs[type as keyof typeof outputs];
        if (!conns) return;

        conns.forEach((outputConns) => {
          outputConns.forEach((conn) => {
            const targetNode = this.nodes.get(conn.action);
            if (!targetNode) return;

            sourceNode.children.push(conn.action);
            targetNode.parents.push(sourceId);
          });
        });
      });
    });
  }

  /**
   * Calculate depth for each node using BFS
   *
   * Depth is the minimum distance from an entry point.
   */
  private calculateDepths(actions: Action[]): void {
    // Find entry points (nodes with no parents)
    const entryPoints = Array.from(this.nodes.values()).filter(
      (node) => node.parents.length === 0
    );

    if (entryPoints.length === 0 && actions.length > 0) {
      // No entry points found, use first action
      const firstNode = this.nodes.get(actions[0].id);
      if (firstNode) {
        entryPoints.push(firstNode);
      }
    }

    // BFS to calculate depths
    const queue: Array<{ nodeId: string; depth: number }> = [];
    const visited = new Set<string>();

    entryPoints.forEach((node) => {
      queue.push({ nodeId: node.action.id, depth: 0 });
      visited.add(node.action.id);
      node.depth = 0;
    });

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      node.children.forEach((childId) => {
        const childNode = this.nodes.get(childId);
        if (!childNode) return;

        const newDepth = depth + 1;

        // Update depth if this path is longer
        if (!visited.has(childId) || childNode.depth < newDepth) {
          childNode.depth = newDepth;
          queue.push({ nodeId: childId, depth: newDepth });
          visited.add(childId);
        }
      });
    }
  }

  /**
   * Group nodes by depth
   */
  private groupByDepth(): Map<number, LayoutNode[]> {
    const groups = new Map<number, LayoutNode[]>();

    this.nodes.forEach((node) => {
      const group = groups.get(node.depth) || [];
      group.push(node);
      groups.set(node.depth, group);
    });

    return groups;
  }

  /**
   * Assign X and Y positions to nodes
   */
  private assignPositions(depthGroups: Map<number, LayoutNode[]>): void {
    const { horizontalSpacing, verticalSpacing, startX, startY } = this.options;

    depthGroups.forEach((nodes, depth) => {
      // Sort nodes by their parent positions for better layout
      this.sortNodesByParentPosition(nodes);

      // Assign vertical indices
      nodes.forEach((node, index) => {
        node.verticalIndex = index;
      });

      // Calculate positions
      const x = startX + depth * horizontalSpacing;

      nodes.forEach((node, index) => {
        const y = startY + index * verticalSpacing;
        node.action.position = [x, y];
      });
    });
  }

  /**
   * Sort nodes by their parent positions to minimize crossings
   */
  private sortNodesByParentPosition(nodes: LayoutNode[]): void {
    nodes.sort((a, b) => {
      // Nodes with no parents go first
      if (a.parents.length === 0) return -1;
      if (b.parents.length === 0) return 1;

      // Sort by average parent Y position
      const avgParentY = (node: LayoutNode): number => {
        if (node.parents.length === 0) return 0;

        const parentYs = node.parents
          .map((parentId) => this.nodes.get(parentId))
          .filter((parent): parent is LayoutNode => parent !== undefined)
          .map((parent) => parent.action.position[1]);

        return parentYs.reduce((sum, y) => sum + y, 0) / parentYs.length;
      };

      return avgParentY(a) - avgParentY(b);
    });
  }

  /**
   * Adjust positions for branching nodes (IF, SWITCH, etc.)
   *
   * Branches should be visually separated to show control flow.
   */
  private adjustBranches(): void {
    const { branchOffset } = this.options;

    this.nodes.forEach((node) => {
      const outputs = this.connections[node.action.id];
      if (!outputs || !outputs.main) return;

      // Check if this is a branching node (multiple outputs)
      if (outputs.main.length <= 1) return;

      // Get child nodes
      const children = outputs.main.flatMap((outputConns) =>
        outputConns
          .map((conn) => this.nodes.get(conn.action))
          .filter((n): n is LayoutNode => n !== undefined)
      );

      if (children.length <= 1) return;

      // Center children around parent Y position
      const parentY = node.action.position[1];
      const totalHeight = (children.length - 1) * this.options.verticalSpacing;
      const startY = parentY - totalHeight / 2;

      children.forEach((child, index) => {
        const x = child.action.position[0];
        const y =
          startY + index * this.options.verticalSpacing + index * branchOffset;
        child.action.position = [x, y];
      });
    });
  }

  /**
   * Apply calculated positions back to actions
   */
  private applyPositions(actions: Action[]): void {
    actions.forEach((action) => {
      const node = this.nodes.get(action.id);
      if (node) {
        action.position = node.action.position;
      }
    });
  }

  /**
   * Calculate optimal starting position for a new node
   *
   * Finds a position that doesn't overlap with existing nodes.
   *
   * @param actions - Existing actions
   * @returns Optimal position [x, y]
   */
  findOptimalPosition(actions: Action[]): [number, number] {
    if (actions.length === 0) {
      return [this.options.startX, this.options.startY];
    }

    // Find rightmost and bottommost positions
    let maxX = this.options.startX;
    let maxY = this.options.startY;

    actions.forEach((action) => {
      maxX = Math.max(maxX, action.position[0]);
      maxY = Math.max(maxY, action.position[1]);
    });

    // Place new node to the right or below
    return [maxX + this.options.horizontalSpacing, this.options.startY];
  }
}

/**
 * Convenience function to layout actions
 *
 * @param actions - Actions to layout
 * @param connections - Connections between actions
 * @param options - Layout options
 *
 * @example
 * layoutActions(actions, connections, { horizontalSpacing: 250 });
 */
export function layoutActions(
  actions: Action[],
  connections: Connections,
  options?: LayoutOptions
): void {
  const layout = new AutoLayout(options);
  layout.layout(actions, connections);
}
