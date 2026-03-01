"use client";

import React from "react";
import type { CursorPosition } from "../mask-editor-types";

interface MaskEditorCanvasProps {
  resultCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  resultContainerRef: React.RefObject<HTMLDivElement | null>;
  cursorPos: CursorPosition | null;
  brushSize: number[];
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  onMouseEnter: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
}

export const MaskEditorCanvas: React.FC<MaskEditorCanvasProps> = ({
  resultCanvasRef,
  resultContainerRef,
  cursorPos,
  brushSize,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseEnter,
  onMouseLeave,
}) => {
  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <h3 className="text-sm font-medium text-brand-primary text-center shrink-0">
        Result (with Transparency) - Draw Here
      </h3>
      <div
        ref={resultContainerRef}
        className="flex-1 bg-surface-raised rounded overflow-hidden relative min-h-0"
      >
        <canvas
          ref={resultCanvasRef}
          className="w-full h-full object-contain cursor-none"
          style={{ imageRendering: "pixelated" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        />
        {cursorPos && (
          <div
            className="absolute pointer-events-none border-2 border-white rounded-full"
            style={{
              left: cursorPos.x,
              top: cursorPos.y,
              width: (brushSize[0] ?? 15) * (cursorPos.scale || 1),
              height: (brushSize[0] ?? 15) * (cursorPos.scale || 1),
              transform: "translate(-50%, -50%)",
              opacity: 0.5,
            }}
          />
        )}
      </div>
    </div>
  );
};
