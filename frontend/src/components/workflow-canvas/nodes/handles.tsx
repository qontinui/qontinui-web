/**
 * Handle Configuration System
 *
 * Components and utilities for managing node connection handles.
 * Handles represent connection points where edges can attach to nodes.
 */

import React from "react";
import { Handle, Position, HandleProps } from "@xyflow/react";
import { ActionType } from "@/lib/action-schema/action-types";

/**
 * Handle configuration for a node
 */
export interface HandleConfig {
  id: string;
  type: "source" | "target";
  position: Position;
  label?: string;
  color?: string;
  isConnectable?: boolean;
}

/**
 * Standard input handle (left side)
 */
export function InputHandle({
  id = "input",
  className = "",
  isConnectable = true,
  ...props
}: Partial<HandleProps>) {
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={id}
      className={`node-handle input-handle ${className}`}
      isConnectable={isConnectable}
      style={{
        width: "12px",
        height: "12px",
        background: "#4b5563",
        border: "2px solid #fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }}
      {...props}
    />
  );
}

/**
 * Standard output handle (right side)
 */
export function OutputHandle({
  id = "main-0",
  className = "",
  isConnectable = true,
  top = "50%",
  ...props
}: Partial<HandleProps> & { top?: string | number }) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      className={`node-handle output-handle ${className}`}
      isConnectable={isConnectable}
      style={{
        top,
        width: "12px",
        height: "12px",
        background: "#4b5563",
        border: "2px solid #fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }}
      {...props}
    />
  );
}

/**
 * Multiple output handles with labels
 */
export interface MultiOutputConfig {
  id: string;
  label: string;
  color?: string;
}

export interface MultiOutputHandlesProps {
  outputs: MultiOutputConfig[];
  showLabels?: boolean;
  className?: string;
}

export function MultiOutputHandles({
  outputs,
  showLabels = true,
  className = "",
}: MultiOutputHandlesProps) {
  if (outputs.length === 0) return null;

  // Calculate vertical spacing for handles
  const totalHandles = outputs.length;
  const spacing = 100 / (totalHandles + 1);

  return (
    <>
      {outputs.map((output, index) => {
        const topPercent = spacing * (index + 1);
        const handleColor = output.color || "#4b5563";

        return (
          <div key={output.id} className="relative">
            <Handle
              type="source"
              position={Position.Right}
              id={output.id}
              className={`node-handle output-handle multi-output ${className}`}
              style={{
                top: `${topPercent}%`,
                width: "12px",
                height: "12px",
                background: handleColor,
                border: "2px solid #fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            />

            {/* Handle Label */}
            {showLabels && (
              <div
                className="absolute right-full mr-3 pointer-events-none"
                style={{ top: `${topPercent}%`, transform: "translateY(-50%)" }}
              >
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-gray-800 text-white shadow-sm"
                  style={{ background: handleColor }}
                >
                  {output.label}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Get handle configuration for action type
 */
export function getHandleConfig(actionType: ActionType): {
  inputs: HandleConfig[];
  outputs: HandleConfig[];
} {
  // Most actions have single input and single output
  const defaultConfig = {
    inputs: [
      {
        id: "input",
        type: "target" as const,
        position: Position.Left,
      },
    ],
    outputs: [
      {
        id: "main-0",
        type: "source" as const,
        position: Position.Right,
      },
    ],
  };

  // Special cases for multi-output actions
  switch (actionType) {
    case "IF":
      return {
        inputs: defaultConfig.inputs,
        outputs: [
          {
            id: "main-0",
            type: "source",
            position: Position.Right,
            label: "True",
            color: "#10b981",
          },
          {
            id: "main-1",
            type: "source",
            position: Position.Right,
            label: "False",
            color: "#ef4444",
          },
        ],
      };

    case "LOOP":
      return {
        inputs: defaultConfig.inputs,
        outputs: [
          {
            id: "main-0",
            type: "source",
            position: Position.Right,
            label: "Loop",
            color: "#3b82f6",
          },
          {
            id: "main-1",
            type: "source",
            position: Position.Right,
            label: "Exit",
            color: "#6b7280",
          },
        ],
      };

    case "TRY_CATCH":
      return {
        inputs: defaultConfig.inputs,
        outputs: [
          {
            id: "main-0",
            type: "source",
            position: Position.Right,
            label: "Success",
            color: "#10b981",
          },
          {
            id: "error-0",
            type: "source",
            position: Position.Right,
            label: "Error",
            color: "#ef4444",
          },
        ],
      };

    case "SWITCH":
      // SWITCH handles are dynamic based on config
      // This is a placeholder - actual implementation should read from config
      return {
        inputs: defaultConfig.inputs,
        outputs: [
          {
            id: "main-0",
            type: "source",
            position: Position.Right,
            label: "Case 0",
          },
          {
            id: "main-1",
            type: "source",
            position: Position.Right,
            label: "Default",
            color: "#6b7280",
          },
        ],
      };

    // Terminal nodes
    case "BREAK":
    case "CONTINUE":
      return {
        inputs: defaultConfig.inputs,
        outputs: [], // No outputs
      };

    default:
      return defaultConfig;
  }
}

/**
 * Get output handles for SWITCH action based on cases
 */
export function getSwitchOutputHandles(cases: number): MultiOutputConfig[] {
  const outputs: MultiOutputConfig[] = [];

  // Add handle for each case (using main-0, main-1, etc. format)
  for (let i = 0; i < cases; i++) {
    outputs.push({
      id: `main-${i}`,
      label: `Case ${i}`,
      color: "#3b82f6",
    });
  }

  // Add default handle (as the last index)
  outputs.push({
    id: `main-${cases}`,
    label: "Default",
    color: "#6b7280",
  });

  return outputs;
}

/**
 * Calculate handle position for index
 */
export function getHandlePosition(index: number, total: number): string {
  const spacing = 100 / (total + 1);
  return `${spacing * (index + 1)}%`;
}

/**
 * Validate if two handles can connect
 */
export function canConnect(
  sourceType: ActionType,
  sourceHandleId: string,
  targetType: ActionType,
  targetHandleId: string
): boolean {
  // Basic validation - source must be 'source' type, target must be 'target' type
  if (targetHandleId !== "input") {
    return false;
  }

  // Can't connect to terminal nodes (BREAK, CONTINUE)
  if (targetType === "BREAK" || targetType === "CONTINUE") {
    return false;
  }

  // Special validation for control flow
  // All control flow nodes now use 'main-N' or 'error-N' format
  if (sourceType === "IF") {
    return sourceHandleId === "main-0" || sourceHandleId === "main-1";
  }

  if (sourceType === "LOOP") {
    return sourceHandleId === "main-0" || sourceHandleId === "main-1";
  }

  if (sourceType === "TRY_CATCH") {
    return sourceHandleId === "main-0" || sourceHandleId === "error-0";
  }

  if (sourceType === "SWITCH") {
    return sourceHandleId.startsWith("main-");
  }

  // Default: main-0 output (or just 'main' for backward compatibility)
  return sourceHandleId === "main-0" || sourceHandleId === "main";
}

/**
 * Get handle color based on type
 */
export function getHandleColor(handleId: string): string {
  if (handleId === "main-0" || handleId === "main") return "#10b981";
  if (handleId === "main-1") return "#ef4444";
  if (handleId === "error-0" || handleId === "error") return "#ef4444";
  if (handleId.startsWith("main-")) return "#3b82f6";
  return "#6b7280";
}
