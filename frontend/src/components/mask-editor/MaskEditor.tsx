"use client";

import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { MaskEditorProps } from "./mask-editor-types";
import { useMaskEditorState } from "./_hooks/use-mask-editor-state";
import { MaskEditorHeader } from "./_components/MaskEditorHeader";
import { MaskEditorToolbar } from "./_components/MaskEditorToolbar";
import { MaskEditorTopControls } from "./_components/MaskEditorTopControls";
import { MaskEditorCanvas } from "./_components/MaskEditorCanvas";
import { MaskEditorSidePanels } from "./_components/MaskEditorSidePanels";
import { MaskEditorFooter } from "./_components/MaskEditorFooter";

export const MaskEditor: React.FC<MaskEditorProps> = ({
  imageUrl,
  imageName: imageNameProp,
  initialMask,
  onSave,
  onCancel,
  open = true,
}) => {
  const state = useMaskEditorState({
    imageUrl,
    initialMask,
    open,
    onSave,
  });

  const imageName =
    imageNameProp || imageUrl.split("/").pop()?.split("?")[0] || "Image";

  const onClose = () => {
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent
        className="!top-[5vh] !translate-y-0 bg-surface-canvas border-border-subtle !max-w-[68vw] p-0 gap-0 flex flex-col"
        style={{ height: "90vh", maxHeight: "90vh" }}
        showCloseButton={false}
      >
        {/* Custom Header */}
        <MaskEditorHeader
          imageName={imageName}
          cropToMask={state.cropToMask}
          onCropToMaskChange={state.setCropToMask}
          onSave={state.handleSave}
          onClose={onClose}
        />

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left Toolbar */}
          <MaskEditorToolbar
            tool={state.tool}
            onToolChange={state.setTool}
            onUndo={state.undo}
            onRedo={state.redo}
            onClear={state.clearMask}
            onRemoveBackground={state.handleRemoveBackground}
            onRemoveBorder={state.handleRemoveBorder}
            canUndo={state.historyIndex > 0}
            canRedo={state.historyIndex < state.history.length - 1}
            isProcessing={state.isProcessing}
          />

          {/* Center Canvas Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top Controls */}
            <MaskEditorTopControls
              brushSize={state.brushSize}
              onBrushSizeChange={state.setBrushSize}
              maxBrushSize={state.maxBrushSize}
              removalTolerance={state.removalTolerance}
              onRemovalToleranceChange={state.setRemovalTolerance}
            />

            <div className="flex-1 flex gap-4 p-4 bg-surface-canvas min-h-0">
              {/* Left Side - Result Canvas (Editable) */}
              <MaskEditorCanvas
                resultCanvasRef={state.resultCanvasRef}
                resultContainerRef={state.resultContainerRef}
                cursorPos={state.cursorPos}
                brushSize={state.brushSize}
                onMouseDown={state.handleMouseDown}
                onMouseMove={state.handleMouseMove}
                onMouseUp={state.handleMouseUp}
                onMouseEnter={state.handleMouseEnter}
                onMouseLeave={state.handleMouseLeave}
              />

              {/* Right Side - Reference Canvases (Display Only) */}
              <MaskEditorSidePanels
                originalCanvasRef={state.originalCanvasRef}
                maskCanvasRef={state.maskCanvasRef}
              />
            </div>

            <MaskEditorFooter />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
