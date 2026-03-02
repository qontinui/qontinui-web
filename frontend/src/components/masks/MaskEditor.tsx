import React from "react";
import type { MaskEditorProps } from "./types";
import { useMaskEditorState } from "./_hooks/useMaskEditorState";
import { MaskEditorHeader } from "./_components/MaskEditorHeader";
import { MaskEditorToolbar } from "./_components/MaskEditorToolbar";
import { MaskEditorControls } from "./_components/MaskEditorControls";
import { MaskEditorCanvas } from "./_components/MaskEditorCanvas";
import { MaskEditorFooter } from "./_components/MaskEditorFooter";

export type { MaskEditorProps } from "./types";
export type { Tool, EditAction } from "./types";

export const MaskEditor: React.FC<MaskEditorProps> = ({
  stateImage,
  initialMask,
  onSave,
  onCancel,
}) => {
  const state = useMaskEditorState({ stateImage, initialMask });

  return (
    <div className="mask-editor bg-surface-canvas text-white p-4 rounded-lg">
      <MaskEditorHeader
        onSave={() => state.saveMask(onSave)}
        onCancel={onCancel}
      />

      <div className="grid grid-cols-[auto_1fr] gap-4">
        <MaskEditorToolbar
          tool={state.tool}
          onToolChange={state.setTool}
          historyIndex={state.historyIndex}
          historyLength={state.historyLength}
          onUndo={state.undo}
          onRedo={state.redo}
          onReset={state.resetMask}
          onExport={state.exportMask}
        />

        <div className="flex flex-col">
          <div className="bg-surface-raised rounded p-4 mb-4">
            <MaskEditorControls
              brushSize={state.brushSize}
              onBrushSizeChange={state.setBrushSize}
              opacity={state.opacity}
              onOpacityChange={state.setOpacity}
              zoom={state.zoom}
              onZoomIn={state.zoomIn}
              onZoomOut={state.zoomOut}
              onResetZoom={state.resetZoom}
            />

            <MaskEditorCanvas
              canvasRef={state.canvasRef}
              maskCanvasRef={state.maskCanvasRef}
              tool={state.tool}
              zoom={state.zoom}
              panOffset={state.panOffset}
              onMouseDown={state.handleMouseDown}
              onMouseMove={state.handleMouseMove}
              onMouseUp={state.handleMouseUp}
            />
          </div>

          <MaskEditorFooter />
        </div>
      </div>
    </div>
  );
};
