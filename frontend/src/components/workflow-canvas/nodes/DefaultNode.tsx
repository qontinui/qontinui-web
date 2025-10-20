/**
 * Default Node component for workflow actions
 *
 * Renders action nodes with handles, labels, and visual states.
 */

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { CanvasNodeData } from '../canvas-types';
import { getActionTypeColor, COLORS, getActionOutputCount } from '../canvas-config';

export interface DefaultNodeProps extends NodeProps {
  data: CanvasNodeData;
}

/**
 * Default node component
 */
export const DefaultNode = memo(({ data, selected }: DefaultNodeProps) => {
  const action = data.action;
  const color = getActionTypeColor(action.type);
  const outputCount = getActionOutputCount(action.type, action.config);

  // Execution state colors
  const stateColors = {
    idle: COLORS.idle,
    running: COLORS.running,
    success: COLORS.successState,
    error: COLORS.errorState,
    warning: COLORS.warning,
  };

  const stateColor = data.executionState
    ? stateColors[data.executionState]
    : COLORS.idle;

  // Node style
  const nodeStyle: React.CSSProperties = {
    backgroundColor: COLORS.backgroundLight,
    border: `2px solid ${selected ? COLORS.selection : color}`,
    borderRadius: 8,
    padding: 12,
    minWidth: 180,
    position: 'relative',
    boxShadow: selected
      ? `0 0 0 2px ${COLORS.selection}40`
      : data.highlighted
      ? `0 0 10px ${color}60`
      : 'none',
    opacity: data.disabled ? 0.5 : 1,
  };

  // Header style
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  };

  // Type badge style
  const badgeStyle: React.CSSProperties = {
    backgroundColor: color,
    color: '#000',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
  };

  // Label style
  const labelStyle: React.CSSProperties = {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: 500,
    flex: 1,
  };

  // Execution state indicator
  const stateIndicatorStyle: React.CSSProperties = {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 12,
    height: 12,
    borderRadius: '50%',
    backgroundColor: stateColor,
    border: `2px solid ${COLORS.background}`,
    display: data.executionState && data.executionState !== 'idle' ? 'block' : 'none',
  };

  return (
    <div style={nodeStyle} className="default-node">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="input-0"
        style={{
          backgroundColor: color,
          border: `2px solid ${COLORS.background}`,
          width: 12,
          height: 12,
        }}
      />

      {/* Execution state indicator */}
      <div style={stateIndicatorStyle} title={data.executionState} />

      {/* Header */}
      <div style={headerStyle}>
        <div style={badgeStyle}>{action.type}</div>
        <div style={labelStyle}>{data.label || action.name || action.type}</div>
      </div>

      {/* Config preview (optional) */}
      {action.config && (
        <div
          style={{
            fontSize: 11,
            color: COLORS.textMuted,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {getConfigPreview(action.type, action.config)}
        </div>
      )}

      {/* Error message */}
      {data.errorMessage && (
        <div
          style={{
            marginTop: 8,
            padding: 6,
            backgroundColor: COLORS.errorState + '20',
            border: `1px solid ${COLORS.errorState}`,
            borderRadius: 4,
            fontSize: 11,
            color: COLORS.errorState,
          }}
        >
          {data.errorMessage}
        </div>
      )}

      {/* Execution duration */}
      {data.executionDuration !== undefined && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            color: COLORS.textDark,
          }}
        >
          {data.executionDuration}ms
        </div>
      )}

      {/* Output handles */}
      {outputCount === 1 ? (
        <Handle
          type="source"
          position={Position.Right}
          id="main-0"
          style={{
            backgroundColor: color,
            border: `2px solid ${COLORS.background}`,
            width: 12,
            height: 12,
          }}
        />
      ) : (
        // Multiple outputs (e.g., IF, SWITCH)
        Array.from({ length: outputCount }).map((_, index) => {
          const handleId = `main-${index}`;
          const offsetPercent = (100 / (outputCount + 1)) * (index + 1);

          return (
            <Handle
              key={handleId}
              type="source"
              position={Position.Right}
              id={handleId}
              style={{
                backgroundColor: color,
                border: `2px solid ${COLORS.background}`,
                width: 12,
                height: 12,
                top: `${offsetPercent}%`,
              }}
            />
          );
        })
      )}
    </div>
  );
});

DefaultNode.displayName = 'DefaultNode';

/**
 * Get preview text for action config
 */
function getConfigPreview(actionType: string, config: any): string {
  switch (actionType) {
    case 'CLICK':
    case 'DOUBLE_CLICK':
    case 'RIGHT_CLICK':
      return config.findBy
        ? `Find by ${config.findBy}: ${config.text || config.image || ''}`
        : 'Click action';

    case 'TYPE':
      return config.text ? `Type: "${config.text.substring(0, 30)}..."` : 'Type text';

    case 'WAIT':
      return config.duration ? `Wait ${config.duration}ms` : 'Wait';

    case 'IF':
      return config.condition ? `If ${config.condition}` : 'Condition';

    case 'LOOP':
      return config.iterations
        ? `Loop ${config.iterations}x`
        : config.condition
        ? `While ${config.condition}`
        : 'Loop';

    case 'SET_VARIABLE':
      return config.name ? `Set ${config.name}` : 'Set variable';

    case 'GET_VARIABLE':
      return config.name ? `Get ${config.name}` : 'Get variable';

    default:
      return '';
  }
}

export default DefaultNode;
