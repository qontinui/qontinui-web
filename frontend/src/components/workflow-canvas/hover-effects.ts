/**
 * Hover Effects Manager - Visual feedback for canvas interactions
 *
 * Manages hover states and visual effects for:
 * - Nodes
 * - Edges
 * - Handles
 *
 * Features:
 * - Smooth transitions (150ms)
 * - Highlight connected elements
 * - Fade non-connected elements
 * - 60 FPS performance
 * - Proper z-index layering
 */

import { Node, Edge } from 'reactflow';
import { CanvasNode, CanvasEdge } from './canvas-types';
import { COLORS, hexToRgba } from './canvas-config';

// ============================================================================
// Types
// ============================================================================

export interface HoverState {
  nodeId: string | null;
  edgeId: string | null;
  handleId: string | null;
  handleType: 'source' | 'target' | null;
}

export interface NodeHoverEffect {
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  scale?: number;
  shadow?: string;
  zIndex?: number;
}

export interface EdgeHoverEffect {
  strokeWidth?: number;
  opacity?: number;
  animated?: boolean;
  color?: string;
}

export interface HandleHoverEffect {
  scale?: number;
  color?: string;
  borderColor?: string;
  shadow?: string;
}

// ============================================================================
// Hover State Manager
// ============================================================================

class HoverEffectsManager {
  private state: HoverState = {
    nodeId: null,
    edgeId: null,
    handleId: null,
    handleType: null,
  };

  private listeners: Array<(state: HoverState) => void> = [];

  /**
   * Set hovered node
   */
  setHoveredNode(nodeId: string | null) {
    if (this.state.nodeId === nodeId) return;

    this.state.nodeId = nodeId;
    this.state.edgeId = null;
    this.state.handleId = null;
    this.state.handleType = null;
    this.notifyListeners();
  }

  /**
   * Set hovered edge
   */
  setHoveredEdge(edgeId: string | null) {
    if (this.state.edgeId === edgeId) return;

    this.state.edgeId = edgeId;
    this.state.nodeId = null;
    this.state.handleId = null;
    this.state.handleType = null;
    this.notifyListeners();
  }

  /**
   * Set hovered handle
   */
  setHoveredHandle(handleId: string | null, handleType: 'source' | 'target' | null = null) {
    if (this.state.handleId === handleId && this.state.handleType === handleType) return;

    this.state.handleId = handleId;
    this.state.handleType = handleType;
    this.state.nodeId = null;
    this.state.edgeId = null;
    this.notifyListeners();
  }

  /**
   * Clear all hover states
   */
  clearHover() {
    if (
      !this.state.nodeId &&
      !this.state.edgeId &&
      !this.state.handleId
    ) {
      return;
    }

    this.state = {
      nodeId: null,
      edgeId: null,
      handleId: null,
      handleType: null,
    };
    this.notifyListeners();
  }

  /**
   * Get current hover state
   */
  getState(): HoverState {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: HoverState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners() {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }
}

// Export singleton instance
export const hoverEffects = new HoverEffectsManager();

// ============================================================================
// Effect Calculators
// ============================================================================

/**
 * Get node hover effect based on hover state
 */
export function getNodeHoverEffect(
  node: CanvasNode,
  hoverState: HoverState,
  connectedNodeIds: Set<string> = new Set()
): NodeHoverEffect {
  const isHovered = hoverState.nodeId === node.id;
  const isConnected = connectedNodeIds.has(node.id);
  const hasActiveHover = hoverState.nodeId !== null || hoverState.edgeId !== null;

  if (isHovered) {
    // Node is being hovered
    return {
      borderColor: COLORS.selection,
      borderWidth: 3,
      opacity: 1,
      scale: 1.02,
      shadow: `0 0 20px ${hexToRgba(COLORS.selection, 0.4)}`,
      zIndex: 1000,
    };
  }

  if (isConnected && hasActiveHover) {
    // Node is connected to hovered element
    return {
      borderColor: COLORS.primary,
      borderWidth: 2,
      opacity: 1,
      scale: 1,
      shadow: `0 0 10px ${hexToRgba(COLORS.primary, 0.3)}`,
      zIndex: 100,
    };
  }

  if (hasActiveHover) {
    // Node is not connected to hovered element - fade it
    return {
      opacity: 0.4,
      scale: 1,
      zIndex: 1,
    };
  }

  // Default state
  return {
    opacity: 1,
    scale: 1,
    zIndex: 1,
  };
}

/**
 * Get edge hover effect based on hover state
 */
export function getEdgeHoverEffect(
  edge: CanvasEdge,
  hoverState: HoverState,
  isConnectedToHoveredNode: boolean = false
): EdgeHoverEffect {
  const isHovered = hoverState.edgeId === edge.id;
  const hasActiveHover = hoverState.nodeId !== null || hoverState.edgeId !== null;

  if (isHovered) {
    // Edge is being hovered
    return {
      strokeWidth: 4,
      opacity: 1,
      animated: true,
      color: COLORS.selection,
    };
  }

  if (isConnectedToHoveredNode && hasActiveHover) {
    // Edge is connected to hovered node
    return {
      strokeWidth: 3,
      opacity: 1,
      animated: false,
    };
  }

  if (hasActiveHover) {
    // Edge is not related to hover - fade it
    return {
      strokeWidth: 2,
      opacity: 0.3,
      animated: false,
    };
  }

  // Default state
  return {
    strokeWidth: 2,
    opacity: 1,
    animated: false,
  };
}

/**
 * Get handle hover effect based on hover state
 */
export function getHandleHoverEffect(
  handleId: string,
  handleType: 'source' | 'target',
  hoverState: HoverState,
  isValidConnection: boolean = true
): HandleHoverEffect {
  const isHovered =
    hoverState.handleId === handleId && hoverState.handleType === handleType;

  if (isHovered) {
    return {
      scale: 1.5,
      color: isValidConnection ? COLORS.success : COLORS.error,
      borderColor: COLORS.background,
      shadow: `0 0 10px ${hexToRgba(isValidConnection ? COLORS.success : COLORS.error, 0.6)}`,
    };
  }

  // Default state
  return {
    scale: 1,
    color: COLORS.primary,
    borderColor: COLORS.background,
  };
}

// ============================================================================
// Connection Graph - Track connected nodes/edges
// ============================================================================

export class ConnectionGraph {
  private nodeToEdges: Map<string, Set<string>> = new Map();
  private edgeToNodes: Map<string, { source: string; target: string }> = new Map();

  /**
   * Build graph from nodes and edges
   */
  build(nodes: CanvasNode[], edges: CanvasEdge[]) {
    this.nodeToEdges.clear();
    this.edgeToNodes.clear();

    // Initialize all nodes
    nodes.forEach(node => {
      this.nodeToEdges.set(node.id, new Set());
    });

    // Map edges to nodes
    edges.forEach(edge => {
      this.edgeToNodes.set(edge.id, {
        source: edge.source,
        target: edge.target,
      });

      // Add edge to source node
      const sourceEdges = this.nodeToEdges.get(edge.source);
      if (sourceEdges) {
        sourceEdges.add(edge.id);
      }

      // Add edge to target node
      const targetEdges = this.nodeToEdges.get(edge.target);
      if (targetEdges) {
        targetEdges.add(edge.id);
      }
    });
  }

  /**
   * Get all edges connected to a node
   */
  getConnectedEdges(nodeId: string): Set<string> {
    return this.nodeToEdges.get(nodeId) || new Set();
  }

  /**
   * Get all nodes connected to a node
   */
  getConnectedNodes(nodeId: string): Set<string> {
    const connectedNodes = new Set<string>();
    const edges = this.getConnectedEdges(nodeId);

    edges.forEach(edgeId => {
      const edgeNodes = this.edgeToNodes.get(edgeId);
      if (edgeNodes) {
        if (edgeNodes.source === nodeId) {
          connectedNodes.add(edgeNodes.target);
        } else {
          connectedNodes.add(edgeNodes.source);
        }
      }
    });

    return connectedNodes;
  }

  /**
   * Get nodes connected to an edge
   */
  getEdgeNodes(edgeId: string): { source: string; target: string } | null {
    return this.edgeToNodes.get(edgeId) || null;
  }

  /**
   * Check if edge is connected to node
   */
  isEdgeConnectedToNode(edgeId: string, nodeId: string): boolean {
    const edgeNodes = this.edgeToNodes.get(edgeId);
    if (!edgeNodes) return false;
    return edgeNodes.source === nodeId || edgeNodes.target === nodeId;
  }
}

// ============================================================================
// Effect Applicator - Apply effects to React Flow elements
// ============================================================================

export class EffectApplicator {
  private connectionGraph = new ConnectionGraph();

  /**
   * Update connection graph
   */
  updateGraph(nodes: CanvasNode[], edges: CanvasEdge[]) {
    this.connectionGraph.build(nodes, edges);
  }

  /**
   * Apply hover effects to all nodes
   */
  applyNodeEffects(
    nodes: CanvasNode[],
    hoverState: HoverState
  ): CanvasNode[] {
    let connectedNodeIds = new Set<string>();

    // Get connected nodes if hovering a node
    if (hoverState.nodeId) {
      connectedNodeIds = this.connectionGraph.getConnectedNodes(hoverState.nodeId);
      connectedNodeIds.add(hoverState.nodeId); // Include hovered node
    }

    // Get connected nodes if hovering an edge
    if (hoverState.edgeId) {
      const edgeNodes = this.connectionGraph.getEdgeNodes(hoverState.edgeId);
      if (edgeNodes) {
        connectedNodeIds.add(edgeNodes.source);
        connectedNodeIds.add(edgeNodes.target);
      }
    }

    return nodes.map(node => {
      const effect = getNodeHoverEffect(node, hoverState, connectedNodeIds);

      return {
        ...node,
        style: {
          ...node.style,
          borderColor: effect.borderColor,
          borderWidth: effect.borderWidth,
          opacity: effect.opacity,
          transform: `scale(${effect.scale || 1})`,
          boxShadow: effect.shadow,
          zIndex: effect.zIndex,
          transition: 'all 150ms ease-in-out',
        },
      };
    });
  }

  /**
   * Apply hover effects to all edges
   */
  applyEdgeEffects(
    edges: CanvasEdge[],
    hoverState: HoverState
  ): CanvasEdge[] {
    return edges.map(edge => {
      const isConnected = hoverState.nodeId
        ? this.connectionGraph.isEdgeConnectedToNode(edge.id, hoverState.nodeId)
        : false;

      const effect = getEdgeHoverEffect(edge, hoverState, isConnected);

      return {
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: effect.strokeWidth,
          opacity: effect.opacity,
          stroke: effect.color || edge.style?.stroke,
          transition: 'all 150ms ease-in-out',
        },
        animated: effect.animated,
      };
    });
  }

  /**
   * Apply all effects
   */
  applyAllEffects(
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    hoverState: HoverState
  ): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    this.updateGraph(nodes, edges);

    return {
      nodes: this.applyNodeEffects(nodes, hoverState),
      edges: this.applyEdgeEffects(edges, hoverState),
    };
  }
}

// Export singleton instance
export const effectApplicator = new EffectApplicator();

// ============================================================================
// React Hook - Use Hover Effects
// ============================================================================

import { useState, useEffect } from 'react';

export function useHoverEffects() {
  const [hoverState, setHoverState] = useState<HoverState>(hoverEffects.getState());

  useEffect(() => {
    return hoverEffects.subscribe(setHoverState);
  }, []);

  return {
    hoverState,
    setHoveredNode: (nodeId: string | null) => hoverEffects.setHoveredNode(nodeId),
    setHoveredEdge: (edgeId: string | null) => hoverEffects.setHoveredEdge(edgeId),
    setHoveredHandle: (handleId: string | null, handleType: 'source' | 'target' | null = null) =>
      hoverEffects.setHoveredHandle(handleId, handleType),
    clearHover: () => hoverEffects.clearHover(),
  };
}

// ============================================================================
// Performance Utilities
// ============================================================================

/**
 * Throttle hover updates to maintain 60 FPS
 */
export function throttleHover<T extends (...args: any[]) => void>(
  fn: T,
  delay: number = 16 // ~60fps
): T {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return ((...args: any[]) => {
    const now = Date.now();

    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
      }, delay - (now - lastCall));
    }
  }) as T;
}

/**
 * Debounce hover updates
 */
export function debounceHover<T extends (...args: any[]) => void>(
  fn: T,
  delay: number = 100
): T {
  let timeoutId: NodeJS.Timeout | null = null;

  return ((...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

export default hoverEffects;
