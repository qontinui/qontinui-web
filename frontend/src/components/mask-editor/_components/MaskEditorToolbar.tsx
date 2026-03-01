"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Paintbrush,
  Eraser,
  Undo,
  Redo,
  Trash2,
  Sparkles,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tool } from "../mask-editor-types";

interface MaskEditorToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onRemoveBackground: () => void;
  onRemoveBorder: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isProcessing: boolean;
}

export const MaskEditorToolbar: React.FC<MaskEditorToolbarProps> = ({
  tool,
  onToolChange,
  onUndo,
  onRedo,
  onClear,
  onRemoveBackground,
  onRemoveBorder,
  canUndo,
  canRedo,
  isProcessing,
}) => {
  return (
    <div className="w-12 bg-surface-raised flex flex-col items-center py-4 gap-2">
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "w-9 h-9",
          tool === "brush" &&
            "bg-brand-secondary hover:bg-brand-secondary/80 text-white"
        )}
        onClick={() => onToolChange("brush")}
        title="Brush - Add to mask"
      >
        <Paintbrush className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "w-9 h-9",
          tool === "eraser" &&
            "bg-brand-secondary hover:bg-brand-secondary/80 text-white"
        )}
        onClick={() => onToolChange("eraser")}
        title="Eraser - Remove from mask"
      >
        <Eraser className="w-4 h-4" />
      </Button>

      <Separator className="w-6 my-1" />

      <Button
        variant="ghost"
        size="icon"
        className="w-9 h-9"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
      >
        <Undo className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="w-9 h-9"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
      >
        <Redo className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="w-9 h-9"
        onClick={onClear}
        title="Clear all masks"
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      <Separator className="w-6 my-1" />

      <Button
        variant="ghost"
        size="icon"
        className="w-9 h-9"
        onClick={onRemoveBackground}
        disabled={isProcessing}
        title="Remove Background"
      >
        <Sparkles className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="w-9 h-9"
        onClick={onRemoveBorder}
        disabled={isProcessing}
        title="Remove Border"
      >
        <Box className="w-4 h-4" />
      </Button>
    </div>
  );
};
