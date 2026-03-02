import React from "react";
import {
  Eraser,
  Brush,
  Square,
  Circle,
  Undo,
  Redo,
  Download,
  RotateCcw,
} from "lucide-react";
import type { Tool } from "../types";

interface ToolButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

const ToolButton: React.FC<ToolButtonProps> = ({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-12 h-12 rounded flex items-center justify-center hover:bg-surface-raised/80 ${
      active ? "bg-purple-600" : ""
    } ${disabled ? "disabled:opacity-50" : ""}`}
    title={title}
  >
    {children}
  </button>
);

interface MaskEditorToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  historyIndex: number;
  historyLength: number;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onExport: () => void;
}

export const MaskEditorToolbar: React.FC<MaskEditorToolbarProps> = ({
  tool,
  onToolChange,
  historyIndex,
  historyLength,
  onUndo,
  onRedo,
  onReset,
  onExport,
}) => {
  return (
    <div className="w-16 bg-surface-raised rounded p-2 space-y-2">
      <ToolButton
        onClick={() => onToolChange("brush")}
        active={tool === "brush"}
        title="Brush"
      >
        <Brush className="w-5 h-5" />
      </ToolButton>
      <ToolButton
        onClick={() => onToolChange("eraser")}
        active={tool === "eraser"}
        title="Eraser"
      >
        <Eraser className="w-5 h-5" />
      </ToolButton>
      <ToolButton
        onClick={() => onToolChange("rectangle")}
        active={tool === "rectangle"}
        title="Rectangle"
      >
        <Square className="w-5 h-5" />
      </ToolButton>
      <ToolButton
        onClick={() => onToolChange("circle")}
        active={tool === "circle"}
        title="Circle"
      >
        <Circle className="w-5 h-5" />
      </ToolButton>

      <div className="h-px bg-surface-raised my-2" />

      <ToolButton onClick={onUndo} disabled={historyIndex < 0} title="Undo">
        <Undo className="w-5 h-5" />
      </ToolButton>
      <ToolButton
        onClick={onRedo}
        disabled={historyIndex >= historyLength - 1}
        title="Redo"
      >
        <Redo className="w-5 h-5" />
      </ToolButton>
      <ToolButton onClick={onReset} title="Reset">
        <RotateCcw className="w-5 h-5" />
      </ToolButton>

      <div className="h-px bg-surface-raised my-2" />

      <ToolButton onClick={onExport} title="Export">
        <Download className="w-5 h-5" />
      </ToolButton>
    </div>
  );
};
