/**
 * Auto-layout algorithm for workflow graphs
 *
 * This module implements sophisticated layout algorithms for positioning
 * workflow actions in a visually pleasing and readable manner.
 *
 * Features:
 * - Hierarchical layering (Sugiyama algorithm)
 * - Branch handling (IF, LOOP, SWITCH)
 * - Overlap reduction
 * - Multiple layout styles
 * - Center alignment
 */

import type { Workflow, Connection, Connections, Action } from '../action-schema/action-types';

/**
 * Layout style options
 */
export enum LayoutStyle {
  /** Top-to-bottom hierarchical layers */
  HIERARCHICAL = 'hierarchical',

  /** Tree-like structure */
  TREE = 'tree',

  /** Physics-based force-directed layout */
  FORCE_DIRECTED = 'force',

  /** Circular arrangement */
  CIRCULAR = 'circular',

  /** Left-to-right flow */
  HORIZONTAL = 'horizontal',
}

/**
 * Layout configuration options
 */
export interface LayoutConfig {
  /** Layout style to use */
  style?: LayoutStyle;

  /** Node dimensions */
  nodeWidth?: number;
  nodeHeight?: number;

  /** Spacing between nodes */
  horizontalSpacing?: number;
  verticalSpacing?: number;

  /** Branch offset for IF/LOOP */
  branchOffset?: number;

  /** Target center point [x, y] */
  centerPoint?: [number, number];

  /** Maximum iterations for overlap reduction */
  maxOverlapIterations?: number;

  /** Minimum spacing between nodes */
  minNodeSpacing?: number;
}

/**
 * Default layout configuration
 */
const DEFAULT_CONFIG: Required<LayoutConfig> = {
  style: LayoutStyle.HIERARCHICAL,
  nodeWidth: 180,
  nodeHeight: 80,
  horizontalSpacing: 200,
  verticalSpacing: 120,
  branchOffset: 150,
  centerPoint: [400, 300],
  maxOverlapIterations: 10,
  minNodeSpacing: 20,
};

/**
 * AutoLayout class - sophisticated graph layout algorithm
 */
export class AutoLayout {
  private config: Required<LayoutConfig>;

  constructor(config?: LayoutConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main layout entry point - assigns positions to all actions
   */
  layout(workflow: Workflow, style?: LayoutStyle): void {
    const layoutStyle = style || this.config.style;

    switch (layoutStyle) {
      case LayoutStyle.HIERARCHICAL:
        this.hierarchicalLayout(workflow);
        break;
      case LayoutStyle.HORIZONTAL:
        this.horizontalLayout(workflow);
        break;
      case LayoutStyle.TREE:
        this.treeLayout(workflow);
        break;
      case LayoutStyle.FORCE_DIRECTED:
        this.forceDirectedLayout(workflow);
        break;
      case LayoutStyle.CIRCULAR:
        this.circularLayout(workflow);
        break;
      default:
        this.hierarchicalLayout(workflow);
    }
  }

  /**
   * Hierarchical layout using Sugiyama algorithm
   */
  private hierarchicalLayout(workflow: Workflow): void {
    if (workflow.actions.length === 0) return;

    // 1. Calculate hierarchical layers
    const layers = this.assignLayers(workflow);

    // 2. Position nodes in each layer
    this.positionLayers(workflow, layers);

    // 3. Handle branches (IF, LOOP, SWITCH)
    this.handleBranches(workflow);

    // 4. Adjust for overlaps
    this.reduceOverlaps(workflow);

    // 5. Center the graph
    this.centerGraph(workflow);
  }

  /**
   * Horizontal left-to-right layout
   */
  private horizontalLayout(workflow: Workflow): void {
    if (workflow.actions.length === 0) return;

    // Similar to hierarchical but swap X and Y axes
    const layers = this.assignLayers(workflow);
    this.positionLayersHorizontal(workflow, layers);
    this.handleBranchesHorizontal(workflow);
    this.reduceOverlaps(workflow);
    this.centerGraph(workflow);
  }

  /**
   * Tree layout - optimized for tree structures
   */
  private treeLayout(workflow: Workflow): void {
    if (workflow.actions.length === 0) return;

    const entryPoints = this.findEntryPoints(workflow);
    if (entryPoints.length === 0) return;

    // Use first entry point as root
    const root = entryPoints[0];
    this.layoutTree(workflow, root, 0, 0, new Set());

    this.reduceOverlaps(workflow);
    this.centerGraph(workflow);
  }

  /**
   * Force-directed layout using physics simulation
   */
  private forceDirectedLayout(workflow: Workflow): void {
    if (workflow.actions.length === 0) return;

    // Initialize random positions
    workflow.actions.forEach((action, i) => {
      const angle = (i / workflow.actions.length) * 2 * Math.PI;
      const radius = 200;
      action.position = [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ];
    });

    // Run force simulation
    const iterations = 100;
    const k = 50; // Optimal distance
    const c = 0.1; // Cooling factor

    for (let iter = 0; iter < iterations; iter++) {
      const forces = new Map<string, [number, number]>();

      // Initialize forces
      workflow.actions.forEach(action => {
        forces.set(action.id, [0, 0]);
      });

      // Repulsive forces between all nodes
      for (let i = 0; i < workflow.actions.length; i++) {
        for (let j = i + 1; j < workflow.actions.length; j++) {
          const a1 = workflow.actions[i];
          const a2 = workflow.actions[j];
          const [x1, y1] = a1.position || [0, 0];
          const [x2, y2] = a2.position || [0, 0];

          const dx = x2 - x1;
          const dy = y2 - y1;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;

          const force = (k * k) / distance;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;

          const f1 = forces.get(a1.id)!;
          const f2 = forces.get(a2.id)!;
          f1[0] -= fx;
          f1[1] -= fy;
          f2[0] += fx;
          f2[1] += fy;
        }
      }

      // Attractive forces for connected nodes
      workflow.actions.forEach(action => {
        const connections = this.getOutgoingConnections(action.id, workflow);
        connections.forEach(conn => {
          const target = this.getAction(workflow, conn.action);
          if (!target) return;

          const [x1, y1] = action.position || [0, 0];
          const [x2, y2] = target.position || [0, 0];

          const dx = x2 - x1;
          const dy = y2 - y1;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;

          const force = (distance * distance) / k;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;

          const f1 = forces.get(action.id)!;
          const f2 = forces.get(target.id)!;
          f1[0] += fx;
          f1[1] += fy;
          f2[0] -= fx;
          f2[1] -= fy;
        });
      });

      // Apply forces with cooling
      const temp = 1 - (iter / iterations);
      workflow.actions.forEach(action => {
        const [fx, fy] = forces.get(action.id)!;
        const [x, y] = action.position || [0, 0];
        action.position = [
          x + fx * c * temp,
          y + fy * c * temp,
        ];
      });
    }

    this.centerGraph(workflow);
  }

  /**
   * Circular layout - arrange nodes in a circle
   */
  private circularLayout(workflow: Workflow): void {
    if (workflow.actions.length === 0) return;

    const radius = Math.max(200, workflow.actions.length * 30);
    const angleStep = (2 * Math.PI) / workflow.actions.length;

    workflow.actions.forEach((action, i) => {
      const angle = i * angleStep;
      action.position = [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ];
    });

    this.centerGraph(workflow);
  }

  /**
   * Assign hierarchical layers using BFS (Sugiyama algorithm step 1)
   */
  private assignLayers(workflow: Workflow): Map<string, number> {
    const layers = new Map<string, number>();
    const entryPoints = this.findEntryPoints(workflow);

    if (entryPoints.length === 0) {
      // No entry points, assign all to layer 0
      workflow.actions.forEach(action => layers.set(action.id, 0));
      return layers;
    }

    // BFS to assign layer numbers
    const queue: Array<{ actionId: string; layer: number }> = entryPoints.map(id => ({
      actionId: id,
      layer: 0,
    }));

    const visited = new Set<string>();

    while (queue.length > 0) {
      const { actionId, layer } = queue.shift()!;

      if (visited.has(actionId)) {
        // Update layer if this path provides a deeper layer
        const currentLayer = layers.get(actionId) ?? -1;
        if (layer > currentLayer) {
          layers.set(actionId, layer);
        }
        continue;
      }

      visited.add(actionId);
      layers.set(actionId, layer);

      // Add children to queue
      const nextActions = this.getNextActions(actionId, workflow);
      nextActions.forEach(nextId => {
        queue.push({ actionId: nextId, layer: layer + 1 });
      });
    }

    // Handle any orphaned nodes
    workflow.actions.forEach(action => {
      if (!layers.has(action.id)) {
        layers.set(action.id, 0);
      }
    });

    return layers;
  }

  /**
   * Position nodes within their assigned layers (vertical layout)
   */
  private positionLayers(workflow: Workflow, layers: Map<string, number>): void {
    // Group actions by layer
    const layerGroups = new Map<number, string[]>();
    layers.forEach((layer, actionId) => {
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, []);
      }
      layerGroups.get(layer)!.push(actionId);
    });

    // Position each layer
    layerGroups.forEach((actionIds, layerNum) => {
      const x = layerNum * (this.config.nodeWidth + this.config.horizontalSpacing);

      // Center actions vertically
      const totalHeight =
        actionIds.length * this.config.nodeHeight +
        (actionIds.length - 1) * this.config.verticalSpacing;
      let y = -totalHeight / 2;

      actionIds.forEach(actionId => {
        const action = this.getAction(workflow, actionId);
        if (action) {
          action.position = [x, y];
          y += this.config.nodeHeight + this.config.verticalSpacing;
        }
      });
    });
  }

  /**
   * Position nodes within their assigned layers (horizontal layout)
   */
  private positionLayersHorizontal(workflow: Workflow, layers: Map<string, number>): void {
    // Group actions by layer
    const layerGroups = new Map<number, string[]>();
    layers.forEach((layer, actionId) => {
      if (!layerGroups.has(layer)) {
        layerGroups.set(layer, []);
      }
      layerGroups.get(layer)!.push(actionId);
    });

    // Position each layer (swap X and Y)
    layerGroups.forEach((actionIds, layerNum) => {
      const y = layerNum * (this.config.nodeHeight + this.config.verticalSpacing);

      // Center actions horizontally
      const totalWidth =
        actionIds.length * this.config.nodeWidth +
        (actionIds.length - 1) * this.config.horizontalSpacing;
      let x = -totalWidth / 2;

      actionIds.forEach(actionId => {
        const action = this.getAction(workflow, actionId);
        if (action) {
          action.position = [x, y];
          x += this.config.nodeWidth + this.config.horizontalSpacing;
        }
      });
    });
  }

  /**
   * Layout tree structure recursively
   */
  private layoutTree(
    workflow: Workflow,
    actionId: string,
    x: number,
    y: number,
    visited: Set<string>
  ): number {
    if (visited.has(actionId)) return 0;
    visited.add(actionId);

    const action = this.getAction(workflow, actionId);
    if (!action) return 0;

    action.position = [x, y];

    const children = this.getNextActions(actionId, workflow);
    if (children.length === 0) return 1;

    let currentY = y;
    let totalWidth = 0;

    children.forEach(childId => {
      const width = this.layoutTree(
        workflow,
        childId,
        x + this.config.nodeWidth + this.config.horizontalSpacing,
        currentY,
        visited
      );
      currentY += width * (this.config.nodeHeight + this.config.verticalSpacing);
      totalWidth += width;
    });

    // Center parent over children
    if (children.length > 1) {
      const childrenHeight =
        totalWidth * this.config.nodeHeight + (totalWidth - 1) * this.config.verticalSpacing;
      action.position[1] = y + (childrenHeight - this.config.nodeHeight) / 2;
    }

    return totalWidth;
  }

  /**
   * Handle branches (IF, LOOP, SWITCH actions)
   */
  private handleBranches(workflow: Workflow): void {
    workflow.actions.forEach(action => {
      if (action.type === 'IF' || action.type === 'TRY_CATCH') {
        this.layoutIfBranch(workflow, action);
      } else if (action.type === 'LOOP') {
        this.layoutLoopBranch(workflow, action);
      } else if (action.type === 'SWITCH') {
        this.layoutSwitchBranch(workflow, action);
      }
    });
  }

  /**
   * Handle branches for horizontal layout
   */
  private handleBranchesHorizontal(workflow: Workflow): void {
    workflow.actions.forEach(action => {
      if (action.type === 'IF' || action.type === 'TRY_CATCH') {
        this.layoutIfBranchHorizontal(workflow, action);
      } else if (action.type === 'LOOP') {
        this.layoutLoopBranchHorizontal(workflow, action);
      }
    });
  }

  /**
   * Layout IF branch - split true/false paths
   */
  private layoutIfBranch(workflow: Workflow, ifAction: Action): void {
    if (!workflow.connections) return;

    const connections = workflow.connections[ifAction.id];
    if (!connections?.main || connections.main.length < 2) return;

    const [trueBranch, falseBranch] = connections.main;

    // Position true branch above IF node
    if (trueBranch && trueBranch.length > 0) {
      this.offsetBranch(workflow, trueBranch, -this.config.branchOffset);
    }

    // Position false branch below IF node
    if (falseBranch && falseBranch.length > 0) {
      this.offsetBranch(workflow, falseBranch, this.config.branchOffset);
    }
  }

  /**
   * Layout IF branch horizontally
   */
  private layoutIfBranchHorizontal(workflow: Workflow, ifAction: Action): void {
    if (!workflow.connections) return;

    const connections = workflow.connections[ifAction.id];
    if (!connections?.main || connections.main.length < 2) return;

    const [trueBranch, falseBranch] = connections.main;

    // Position branches horizontally offset
    if (trueBranch && trueBranch.length > 0) {
      this.offsetBranchHorizontal(workflow, trueBranch, -this.config.branchOffset);
    }

    if (falseBranch && falseBranch.length > 0) {
      this.offsetBranchHorizontal(workflow, falseBranch, this.config.branchOffset);
    }
  }

  /**
   * Layout LOOP branch
   */
  private layoutLoopBranch(workflow: Workflow, loopAction: Action): void {
    if (!workflow.connections) return;

    const connections = workflow.connections[loopAction.id];
    if (!connections?.main || connections.main.length === 0) return;

    const [loopBody] = connections.main;

    // Offset loop body slightly
    if (loopBody && loopBody.length > 0) {
      this.offsetBranch(workflow, loopBody, this.config.branchOffset / 2);
    }
  }

  /**
   * Layout LOOP branch horizontally
   */
  private layoutLoopBranchHorizontal(workflow: Workflow, loopAction: Action): void {
    if (!workflow.connections) return;

    const connections = workflow.connections[loopAction.id];
    if (!connections?.main || connections.main.length === 0) return;

    const [loopBody] = connections.main;

    if (loopBody && loopBody.length > 0) {
      this.offsetBranchHorizontal(workflow, loopBody, this.config.branchOffset / 2);
    }
  }

  /**
   * Layout SWITCH branch - multiple outputs
   */
  private layoutSwitchBranch(workflow: Workflow, switchAction: Action): void {
    if (!workflow.connections) return;

    const connections = workflow.connections[switchAction.id];
    if (!connections?.main) return;

    const branches = connections.main;
    const numBranches = branches.length;

    if (numBranches === 0) return;

    // Distribute branches evenly above and below
    const totalOffset = (numBranches - 1) * this.config.branchOffset;
    let currentOffset = -totalOffset / 2;

    branches.forEach(branch => {
      if (branch && branch.length > 0) {
        this.offsetBranch(workflow, branch, currentOffset);
      }
      currentOffset += this.config.branchOffset;
    });
  }

  /**
   * Apply Y offset to all actions in a branch
   */
  private offsetBranch(workflow: Workflow, branch: Connection[], yOffset: number): void {
    const visited = new Set<string>();

    const applyOffset = (connections: Connection[], depth: number = 0) => {
      connections.forEach(conn => {
        if (visited.has(conn.action)) return;
        visited.add(conn.action);

        const action = this.getAction(workflow, conn.action);
        if (action && action.position) {
          // Apply offset with decay for deeper nodes
          const decay = Math.max(0.5, 1 - depth * 0.1);
          action.position[1] += yOffset * decay;

          // Recursively apply to children
          const nextConnections = this.getOutgoingConnections(conn.action, workflow);
          applyOffset(nextConnections, depth + 1);
        }
      });
    };

    applyOffset(branch);
  }

  /**
   * Apply X offset to all actions in a branch (horizontal layout)
   */
  private offsetBranchHorizontal(workflow: Workflow, branch: Connection[], xOffset: number): void {
    const visited = new Set<string>();

    const applyOffset = (connections: Connection[], depth: number = 0) => {
      connections.forEach(conn => {
        if (visited.has(conn.action)) return;
        visited.add(conn.action);

        const action = this.getAction(workflow, conn.action);
        if (action && action.position) {
          const decay = Math.max(0.5, 1 - depth * 0.1);
          action.position[0] += xOffset * decay;

          const nextConnections = this.getOutgoingConnections(conn.action, workflow);
          applyOffset(nextConnections, depth + 1);
        }
      });
    };

    applyOffset(branch);
  }

  /**
   * Reduce overlaps using iterative separation
   */
  private reduceOverlaps(workflow: Workflow): void {
    for (let iter = 0; iter < this.config.maxOverlapIterations; iter++) {
      let hadOverlap = false;

      // Check all pairs for overlaps
      for (let i = 0; i < workflow.actions.length; i++) {
        for (let j = i + 1; j < workflow.actions.length; j++) {
          if (this.hasOverlap(workflow.actions[i], workflow.actions[j])) {
            this.separateNodes(workflow.actions[i], workflow.actions[j]);
            hadOverlap = true;
          }
        }
      }

      if (!hadOverlap) break;
    }
  }

  /**
   * Check if two actions overlap
   */
  private hasOverlap(action1: Action, action2: Action): boolean {
    if (!action1.position || !action2.position) return false;

    const [x1, y1] = action1.position;
    const [x2, y2] = action2.position;

    const overlapX = Math.abs(x1 - x2) < this.config.nodeWidth + this.config.minNodeSpacing;
    const overlapY = Math.abs(y1 - y2) < this.config.nodeHeight + this.config.minNodeSpacing;

    return overlapX && overlapY;
  }

  /**
   * Separate two overlapping nodes
   */
  private separateNodes(action1: Action, action2: Action): void {
    if (!action1.position || !action2.position) return;

    const [x1, y1] = action1.position;
    const [x2, y2] = action2.position;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;

    // Push apart in the direction they're already separated
    const targetDistance = Math.max(
      this.config.nodeWidth + this.config.minNodeSpacing,
      this.config.nodeHeight + this.config.minNodeSpacing
    );

    const pushX = (dx / distance) * (targetDistance / 2);
    const pushY = (dy / distance) * (targetDistance / 2);

    action1.position[0] -= pushX;
    action1.position[1] -= pushY;
    action2.position[0] += pushX;
    action2.position[1] += pushY;
  }

  /**
   * Center the entire graph
   */
  private centerGraph(workflow: Workflow): void {
    if (workflow.actions.length === 0) return;

    // Find bounding box
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    workflow.actions.forEach(action => {
      if (!action.position) return;
      const [x, y] = action.position;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    // Calculate center offset
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    const [targetX, targetY] = this.config.centerPoint;
    const offsetX = targetX - graphCenterX;
    const offsetY = targetY - graphCenterY;

    // Apply offset to all nodes
    workflow.actions.forEach(action => {
      if (!action.position) return;
      action.position[0] += offsetX;
      action.position[1] += offsetY;
    });
  }

  /**
   * Find entry points (actions with no incoming connections)
   */
  private findEntryPoints(workflow: Workflow): string[] {
    if (!workflow.connections) {
      // Sequential workflow - first action is entry point
      return workflow.actions.length > 0 ? [workflow.actions[0].id] : [];
    }

    const hasIncoming = new Set<string>();

    // Mark all actions that have incoming connections
    Object.values(workflow.connections).forEach(connGroup => {
      ['main', 'error', 'success', 'parallel'].forEach(type => {
        const connections = connGroup[type as keyof typeof connGroup];
        if (connections) {
          connections.forEach(connArray => {
            connArray.forEach(conn => {
              hasIncoming.add(conn.action);
            });
          });
        }
      });
    });

    // Entry points are actions without incoming connections
    const entryPoints = workflow.actions
      .filter(action => !hasIncoming.has(action.id))
      .map(action => action.id);

    return entryPoints;
  }

  /**
   * Get all actions connected from this action
   */
  private getNextActions(actionId: string, workflow: Workflow): string[] {
    if (!workflow.connections) return [];

    const connections = workflow.connections[actionId];
    if (!connections) return [];

    const nextActions: string[] = [];

    ['main', 'error', 'success', 'parallel'].forEach(type => {
      const connArray = connections[type as keyof typeof connections];
      if (connArray) {
        connArray.forEach(conns => {
          conns.forEach(conn => {
            nextActions.push(conn.action);
          });
        });
      }
    });

    return nextActions;
  }

  /**
   * Get all outgoing connections from an action
   */
  private getOutgoingConnections(actionId: string, workflow: Workflow): Connection[] {
    if (!workflow.connections) return [];

    const connections = workflow.connections[actionId];
    if (!connections) return [];

    const allConnections: Connection[] = [];

    ['main', 'error', 'success', 'parallel'].forEach(type => {
      const connArray = connections[type as keyof typeof connections];
      if (connArray) {
        connArray.forEach(conns => {
          allConnections.push(...conns);
        });
      }
    });

    return allConnections;
  }

  /**
   * Get action by ID
   */
  private getAction(workflow: Workflow, actionId: string): Action | undefined {
    return workflow.actions.find(a => a.id === actionId);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<LayoutConfig> {
    return { ...this.config };
  }
}

/**
 * Convenience function to apply auto-layout to a workflow
 */
export function autoLayoutWorkflow(
  workflow: Workflow,
  config?: LayoutConfig,
  style?: LayoutStyle
): void {
  const layout = new AutoLayout(config);
  layout.layout(workflow, style);
}
