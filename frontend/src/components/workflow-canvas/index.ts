/**
 * Workflow Canvas module exports
 */

// Main component
export { WorkflowCanvas } from './WorkflowCanvas';
export type { WorkflowCanvasProps } from './WorkflowCanvas';

// Types
export type {
  CanvasNode,
  CanvasEdge,
  CanvasNodeData,
  CanvasEdgeData,
  CanvasViewport,
  CanvasSettings,
  ActionCategory,
  ConnectionValidationResult,
  ConnectionAttempt,
  NodeClickEvent,
  EdgeClickEvent,
  CanvasClickEvent,
  HandleDefinition,
} from './canvas-types';

export {
  DEFAULT_CANVAS_SETTINGS,
  ACTION_TYPE_TO_CATEGORY,
  getActionCategory,
  getNodeType,
  NODE_TYPES,
} from './canvas-types';

// Configuration
export {
  COLORS,
  GRID_CONFIG,
  ZOOM_CONFIG,
  SNAP_CONFIG,
  CANVAS_CONFIG,
  ANIMATION_CONFIG,
  HANDLE_CONFIG,
  SELECTION_CONFIG,
  EDGE_CONFIG,
  MINIMAP_CONFIG,
  CONTROLS_CONFIG,
  PERFORMANCE_CONFIG,
  NODE_DIMENSIONS,
  getCategoryColor,
  getActionTypeColor,
  getConnectionColor,
  getConnectionStyle,
  getNodeDimensions,
  getDarkerColor,
  getLighterColor,
  hexToRgba,
} from './canvas-config';

// Utilities
export {
  workflowToReactFlow,
  reactFlowToWorkflow,
  validateConnection,
  fitViewport,
  autoLayout,
  getSelectedNodes,
  getNodeById,
  updateNodePosition,
  updateNodeData,
  getConnectedEdges,
  getIncomingEdges,
  getOutgoingEdges,
  updateEdgeAnimation,
} from './canvas-utils';

// Components
export { CustomEdge, SimpleCustomEdge, StraightCustomEdge, ExecutionEdge } from './CustomEdge';
export { DefaultNode } from './nodes/DefaultNode';
