import { useState, useCallback, useRef } from "react";
import React from "react";

interface LegendPanelState {
  isLegendCollapsed: boolean;
  setIsLegendCollapsed: (collapsed: boolean) => void;
  isLegendFloating: boolean;
  setIsLegendFloating: (floating: boolean) => void;
  legendPosition: { x: number; y: number };
  handleLegendDragStart: (e: React.MouseEvent) => void;
}

export function useLegendPanel(): LegendPanelState {
  const [isLegendCollapsed, setIsLegendCollapsed] = useState(false);
  const [isLegendFloating, setIsLegendFloating] = useState(false);
  const [legendPosition, setLegendPosition] = useState({ x: 16, y: 16 });
  const legendDragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  const handleLegendDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isLegendFloating) return;
      e.preventDefault();
      e.stopPropagation();
      legendDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: legendPosition.x,
        initialY: legendPosition.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!legendDragRef.current) return;
        const deltaX = moveEvent.clientX - legendDragRef.current.startX;
        const deltaY = moveEvent.clientY - legendDragRef.current.startY;
        setLegendPosition({
          x: legendDragRef.current.initialX + deltaX,
          y: legendDragRef.current.initialY + deltaY,
        });
      };

      const handleMouseUp = () => {
        legendDragRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isLegendFloating, legendPosition]
  );

  return {
    isLegendCollapsed,
    setIsLegendCollapsed,
    isLegendFloating,
    setIsLegendFloating,
    legendPosition,
    handleLegendDragStart,
  };
}
