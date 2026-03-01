"use client";

import React from "react";

interface MaskEditorSidePanelsProps {
  originalCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export const MaskEditorSidePanels: React.FC<MaskEditorSidePanelsProps> = ({
  originalCanvasRef,
  maskCanvasRef,
}) => {
  return (
    <div className="w-64 flex flex-col gap-4 shrink-0">
      {/* Original Image */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <h3 className="text-sm font-medium text-text-muted text-center shrink-0">
          Original Image
        </h3>
        <div className="flex-1 bg-surface-raised rounded overflow-hidden min-h-0">
          <canvas
            ref={originalCanvasRef}
            className="w-full h-full object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      </div>

      {/* Mask Visualization */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <h3 className="text-sm font-medium text-text-muted text-center shrink-0">
          Mask
        </h3>
        <div className="flex-1 bg-surface-raised rounded overflow-hidden min-h-0">
          <canvas
            ref={maskCanvasRef}
            className="w-full h-full object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      </div>
    </div>
  );
};
