import React from "react";
import type { Tool } from "../types";

interface MaskEditorCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  tool: Tool;
  zoom: number;
  panOffset: { x: number; y: number };
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
}

function getCursorStyle(tool: Tool): string {
  switch (tool) {
    case "brush":
      return "crosshair";
    case "eraser":
      return "grab";
    default:
      return "default";
  }
}

export const MaskEditorCanvas: React.FC<MaskEditorCanvasProps> = ({
  canvasRef,
  maskCanvasRef,
  tool,
  zoom,
  panOffset,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}) => {
  return (
    <div
      className="relative overflow-hidden bg-surface-canvas rounded"
      style={{
        width: "100%",
        height: "500px",
        cursor: getCursorStyle(tool),
      }}
    >
      <div
        style={{
          transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
          transformOrigin: "top left",
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          className="border border-border-default"
        />
        <canvas ref={maskCanvasRef} className="hidden" />
      </div>
    </div>
  );
};
