import React from "react";

export type TooltipPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TooltipProps {
  content: React.ReactNode;
  placement?: TooltipPlacement;
  delay?: number;
  offset?: number;
  children: React.ReactNode;
  disabled?: boolean;
}

export interface NodeTooltipData {
  actionName: string;
  actionType: string;
  category: string;
  inputCount?: number;
  outputCount?: number;
  executionState?: "idle" | "running" | "success" | "error" | "warning";
  executionDuration?: number;
  errorMessage?: string;
  disabled?: boolean;
}

export interface HandleTooltipData {
  connectionType: "main" | "error" | "success" | "parallel";
  outputIndex: number;
  connectedCount: number;
  description?: string;
}

export interface EdgeTooltipData {
  sourceNode: string;
  targetNode: string;
  connectionType: "main" | "error" | "success" | "parallel";
  executionCount?: number;
  lastExecuted?: Date;
}

export interface TooltipState {
  content: React.ReactNode;
  position: { x: number; y: number };
  placement: TooltipPlacement;
}
