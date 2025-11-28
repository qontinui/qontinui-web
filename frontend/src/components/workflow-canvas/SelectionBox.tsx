/**
 * Selection Box - Rectangle selection for multiple nodes
 *
 * Features:
 * - Drag to select multiple nodes
 * - Shift to add to selection
 * - Ctrl/Cmd to remove from selection
 * - Visual feedback (dashed border)
 * - Select nodes and edges together
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { COLORS, hexToRgba } from "./canvas-config";

// ============================================================================
// Types
// ============================================================================

export interface SelectionBoxProps {
  start: { x: number; y: number };
  end: { x: number; y: number };
  mode: "add" | "remove" | "replace";
}

export interface SelectionBoxState {
  active: boolean;
  start: { x: number; y: number } | null;
  current: { x: number; y: number } | null;
  mode: "add" | "remove" | "replace";
}

// ============================================================================
// Selection Box Component
// ============================================================================

export function SelectionBox({ start, end, mode }: SelectionBoxProps) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  const borderColor = mode === "remove" ? COLORS.error : COLORS.selection;
  const fillColor = hexToRgba(borderColor, 0.1);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: `2px dashed ${borderColor}`,
        backgroundColor: fillColor,
        borderRadius: "4px",
        zIndex: 9999,
        transition: "none",
      }}
    >
      {/* Mode indicator */}
      <div
        className="absolute -top-6 left-0 px-2 py-1 text-xs rounded"
        style={{
          backgroundColor: borderColor,
          color: "white",
        }}
      >
        {mode === "add"
          ? "Add to selection"
          : mode === "remove"
            ? "Remove from selection"
            : "Select"}
      </div>
    </div>
  );
}

// ============================================================================
// Selection Box Hook
// ============================================================================

export function useSelectionBox() {
  const [state, setState] = useState<SelectionBoxState>({
    active: false,
    start: null,
    current: null,
    mode: "replace",
  });

  const startSelection = useCallback(
    (
      position: { x: number; y: number },
      shiftKey: boolean,
      ctrlKey: boolean
    ) => {
      setState({
        active: true,
        start: position,
        current: position,
        mode: shiftKey ? "add" : ctrlKey ? "remove" : "replace",
      });
    },
    []
  );

  const updateSelection = useCallback((position: { x: number; y: number }) => {
    setState((prev) => ({
      ...prev,
      current: position,
    }));
  }, []);

  const endSelection = useCallback(() => {
    setState({
      active: false,
      start: null,
      current: null,
      mode: "replace",
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setState({
      active: false,
      start: null,
      current: null,
      mode: "replace",
    });
  }, []);

  return {
    state,
    startSelection,
    updateSelection,
    endSelection,
    cancelSelection,
  };
}

// ============================================================================
// Selection Box Manager
// ============================================================================

export function SelectionBoxManager({
  onSelectionChange,
  containerRef,
}: {
  onSelectionChange?: (
    bounds: { x: number; y: number; width: number; height: number },
    mode: "add" | "remove" | "replace"
  ) => void;
  containerRef?: React.RefObject<HTMLElement>;
}) {
  const {
    state,
    startSelection,
    updateSelection,
    endSelection,
    cancelSelection,
  } = useSelectionBox();
  const isDragging = useRef(false);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Only start selection on left click on canvas background
      if (e.button !== 0) return;
      if (
        (e.target as HTMLElement).closest(
          ".react-flow__node, .react-flow__edge"
        )
      )
        return;

      isDragging.current = true;
      const rect = container.getBoundingClientRect();
      const position = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      startSelection(position, e.shiftKey, e.ctrlKey || e.metaKey);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !state.active) return;

      const rect = container.getBoundingClientRect();
      const position = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      updateSelection(position);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current || !state.active) return;

      isDragging.current = false;

      if (state.start && state.current && onSelectionChange) {
        const x = Math.min(state.start.x, state.current.x);
        const y = Math.min(state.start.y, state.current.y);
        const width = Math.abs(state.current.x - state.start.x);
        const height = Math.abs(state.current.y - state.start.y);

        onSelectionChange({ x, y, width, height }, state.mode);
      }

      endSelection();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.active) {
        isDragging.current = false;
        cancelSelection();
      }
    };

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    state,
    containerRef,
    startSelection,
    updateSelection,
    endSelection,
    cancelSelection,
    onSelectionChange,
  ]);

  if (!state.active || !state.start || !state.current) return null;

  return (
    <SelectionBox start={state.start} end={state.current} mode={state.mode} />
  );
}

export default SelectionBox;
