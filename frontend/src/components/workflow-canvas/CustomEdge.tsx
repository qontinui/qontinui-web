/**
 * Custom Edge component for workflow connections
 *
 * Renders styled edges with labels, animations, and interactive elements.
 */

import React, { useState } from 'react';
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from 'reactflow';
import { X } from 'lucide-react';
import { CanvasEdgeData } from './canvas-types';
import { getConnectionColor, hexToRgba } from './canvas-config';

export interface CustomEdgeProps extends EdgeProps {
  data: CanvasEdgeData;
}

/**
 * Custom edge component with styling, labels, and delete button
 */
export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}: CustomEdgeProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Calculate edge path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Get connection color
  const connectionColor = getConnectionColor(data.connectionType);
  const isSelected = selected || data.selected;

  // Calculate edge style
  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: connectionColor,
    strokeWidth: isSelected ? 3 : isHovered ? 3 : 2,
    strokeDasharray: data.connectionType === 'parallel' ? '5,5' : undefined,
    opacity: data.recentlyTraversed ? 1 : 0.8,
    transition: 'stroke-width 0.15s ease-in-out, opacity 0.15s ease-in-out',
  };

  // Label style
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    fontSize: 11,
    fontWeight: 500,
    background: '#27272A',
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${connectionColor}`,
    color: connectionColor,
    pointerEvents: 'all',
    opacity: isHovered || isSelected || data.label ? 1 : 0,
    transition: 'opacity 0.15s ease-in-out',
  };

  // Delete button style
  const deleteButtonStyle: React.CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - 30}px)`,
    pointerEvents: 'all',
    opacity: isHovered && !data.label ? 1 : 0,
    transition: 'opacity 0.15s ease-in-out',
  };

  return (
    <>
      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
        interactionWidth={20}
      />

      {/* Animated flow indicator (when edge is animated) */}
      {data.animated && (
        <circle r="4" fill={connectionColor}>
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* Edge label and delete button */}
      <EdgeLabelRenderer>
        {/* Label */}
        {data.label && (
          <div
            style={labelStyle}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="nodrag nopan"
          >
            {data.label}
          </div>
        )}

        {/* Delete button (shown on hover) */}
        <div
          style={deleteButtonStyle}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="nodrag nopan"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Edge deletion is handled by the parent component
              // This dispatches a custom event that WorkflowCanvas listens for
              const event = new CustomEvent('delete-edge', {
                detail: { edgeId: id },
              });
              window.dispatchEvent(event);
            }}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
            title="Delete connection"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * Simple custom edge (no delete button, simpler rendering)
 */
export function SimpleCustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}: CustomEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const connectionColor = getConnectionColor(data.connectionType);
  const isSelected = selected || data.selected;

  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: connectionColor,
    strokeWidth: isSelected ? 3 : 2,
    strokeDasharray: data.connectionType === 'parallel' ? '5,5' : undefined,
  };

  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    fontSize: 11,
    fontWeight: 500,
    background: '#27272A',
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${connectionColor}`,
    color: connectionColor,
    pointerEvents: 'none',
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
      />

      {data.animated && (
        <circle r="4" fill={connectionColor}>
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {data.label && (
        <EdgeLabelRenderer>
          <div style={labelStyle} className="nodrag nopan">
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Straight edge (for special cases)
 */
export function StraightCustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
  style,
}: CustomEdgeProps) {
  const connectionColor = getConnectionColor(data.connectionType);
  const isSelected = selected || data.selected;

  // Calculate straight path
  const edgePath = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;

  // Calculate label position (midpoint)
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2;

  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: connectionColor,
    strokeWidth: isSelected ? 3 : 2,
  };

  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
    fontSize: 11,
    fontWeight: 500,
    background: '#27272A',
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${connectionColor}`,
    color: connectionColor,
    pointerEvents: 'none',
  };

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        style={edgeStyle}
        markerEnd={markerEnd}
        className="react-flow__edge-path"
      />

      {data.label && (
        <EdgeLabelRenderer>
          <div style={labelStyle} className="nodrag nopan">
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * Edge with execution indicator
 */
export function ExecutionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}: CustomEdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const connectionColor = getConnectionColor(data.connectionType);
  const isSelected = selected || data.selected;

  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: connectionColor,
    strokeWidth: isSelected ? 3 : 2,
    opacity: data.recentlyTraversed ? 1 : 0.5,
  };

  // Glow effect for recently traversed
  const glowStyle: React.CSSProperties = {
    ...edgeStyle,
    stroke: connectionColor,
    strokeWidth: 8,
    opacity: 0.3,
    filter: `blur(4px)`,
  };

  return (
    <>
      {/* Glow layer */}
      {data.recentlyTraversed && (
        <path
          d={edgePath}
          fill="none"
          style={glowStyle}
          className="react-flow__edge-path"
        />
      )}

      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
      />

      {/* Flow indicator */}
      {data.animated && (
        <circle r="5" fill={connectionColor}>
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  );
}

// Export as default
export default CustomEdge;
