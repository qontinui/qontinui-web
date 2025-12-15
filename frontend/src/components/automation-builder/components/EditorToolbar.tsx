/**
 * EditorToolbar Component
 *
 * Provides common actions for the automation builder:
 * - Save/Undo/Redo
 * - Delete item
 * - Duplicate item
 * - Format conversion
 * - Run/Test
 *
 * Adapts its appearance and actions based on the current mode and item type.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Save,
  Trash2,
  Copy,
  Play,
  TestTube,
  Undo,
  Redo,
  Download,
  Upload,
  Share2,
  FolderDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryItem, BuilderMode } from "../types";

export interface EditorToolbarProps {
  item: LibraryItem | null;
  mode: BuilderMode;
  onSave?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onRun?: () => void;
  onTest?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onExportProject?: () => void;
  onShare?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  isSaving?: boolean;
  className?: string;
}

export function EditorToolbar({
  item,
  mode,
  onSave,
  onDelete,
  onDuplicate,
  onRun,
  onTest,
  onUndo,
  onRedo,
  onExport,
  onImport,
  onExportProject,
  onShare,
  canUndo = false,
  canRedo = false,
  isSaving = false,
  className,
}: EditorToolbarProps) {
  const isSequential = mode === "sequential";

  // Color theme based on mode
  const accentColor = isSequential ? "#00D9FF" : "#00FF88";

  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950",
        className
      )}
    >
      {/* Left side - Primary actions */}
      <div className="flex items-center gap-2">
        {/* Save Button */}
        {onSave && (
          <Button
            onClick={onSave}
            disabled={!item || isSaving}
            size="sm"
            data-tutorial-id="save-workflow"
            style={{
              backgroundColor: item ? `${accentColor}22` : undefined,
              borderColor: item ? `${accentColor}44` : undefined,
              color: item ? accentColor : undefined,
            }}
            className={cn(
              "border transition-colors",
              !item && "bg-gray-800 border-gray-700 text-gray-400"
            )}
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        )}

        {/* Undo/Redo */}
        {(onUndo || onRedo) && (
          <div className="flex items-center gap-1 ml-2">
            {onUndo && (
              <Button
                onClick={onUndo}
                disabled={!canUndo}
                size="sm"
                variant="ghost"
                className="text-gray-400 hover:text-white hover:bg-gray-800"
                title="Undo (Ctrl+Z)"
              >
                <Undo className="w-4 h-4" />
              </Button>
            )}
            {onRedo && (
              <Button
                onClick={onRedo}
                disabled={!canRedo}
                size="sm"
                variant="ghost"
                className="text-gray-400 hover:text-white hover:bg-gray-800"
                title="Redo (Ctrl+Y)"
              >
                <Redo className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}

        {/* Divider */}
        {(onSave || onUndo || onRedo) && item && (
          <div className="h-6 w-px bg-gray-700 mx-2" />
        )}

        {/* Run/Test Buttons */}
        {item && (
          <>
            {onRun && (
              <Button
                onClick={onRun}
                size="sm"
                variant="ghost"
                data-tutorial-id="run-workflow"
                className="text-gray-300 hover:text-white hover:bg-gray-800"
              >
                <Play className="w-4 h-4 mr-2" />
                Run
              </Button>
            )}
            {onTest && (
              <Button
                onClick={onTest}
                size="sm"
                variant="ghost"
                className="text-gray-300 hover:text-white hover:bg-gray-800"
              >
                <TestTube className="w-4 h-4 mr-2" />
                Test
              </Button>
            )}
          </>
        )}
      </div>

      {/* Right side - Secondary actions */}
      <div className="flex items-center gap-2">
        {/* Share Button */}
        {item && onShare && (
          <Button
            onClick={onShare}
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white hover:bg-gray-800"
            title="Share Project"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        )}

        {/* Divider */}
        {item && onShare && <div className="h-6 w-px bg-gray-700 mx-1" />}

        {/* Export Project */}
        {onExportProject && (
          <Button
            onClick={onExportProject}
            size="sm"
            variant="ghost"
            className="text-gray-300 hover:text-white hover:bg-gray-800"
            title="Export entire project for qontinui-runner"
          >
            <FolderDown className="w-4 h-4 mr-2" />
            Export Project
          </Button>
        )}

        {/* Divider */}
        {onExportProject && <div className="h-6 w-px bg-gray-700 mx-1" />}

        {/* Import/Export Workflow */}
        {item && (
          <>
            {onExport && (
              <Button
                onClick={onExport}
                size="sm"
                variant="ghost"
                className="text-gray-400 hover:text-white hover:bg-gray-800"
                title="Export Workflow"
              >
                <Download className="w-4 h-4" />
              </Button>
            )}
            {onImport && (
              <Button
                onClick={onImport}
                size="sm"
                variant="ghost"
                className="text-gray-400 hover:text-white hover:bg-gray-800"
                title="Import Workflow"
              >
                <Upload className="w-4 h-4" />
              </Button>
            )}

            {/* Divider */}
            {(onExport || onImport) && (
              <div className="h-6 w-px bg-gray-700 mx-1" />
            )}
          </>
        )}

        {/* Duplicate Button */}
        {item && onDuplicate && (
          <Button
            onClick={onDuplicate}
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white hover:bg-gray-800"
            title="Duplicate"
          >
            <Copy className="w-4 h-4 mr-2" />
            Duplicate
          </Button>
        )}

        {/* Delete Button */}
        {item && onDelete && (
          <Button
            onClick={onDelete}
            size="sm"
            variant="ghost"
            className="text-red-400 hover:text-red-300 hover:bg-red-950/30"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Compact variant with icons only
 */
export interface CompactToolbarProps extends EditorToolbarProps {
  showLabels?: false;
}

export function CompactToolbar({
  item,
  mode,
  onSave,
  onDelete,
  onDuplicate,
  onRun,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  isSaving = false,
  className,
}: CompactToolbarProps) {
  const isSequential = mode === "sequential";
  const accentColor = isSequential ? "#00D9FF" : "#00FF88";

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 border-b border-gray-800 bg-gray-950",
        className
      )}
    >
      {/* Save */}
      {onSave && (
        <Button
          onClick={onSave}
          disabled={!item || isSaving}
          size="sm"
          variant="ghost"
          data-tutorial-id="save-workflow"
          className="h-8 w-8 p-0"
          style={{
            color: item ? accentColor : undefined,
          }}
          title="Save"
        >
          <Save className="w-4 h-4" />
        </Button>
      )}

      {/* Undo/Redo */}
      {onUndo && (
        <Button
          onClick={onUndo}
          disabled={!canUndo}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Undo"
        >
          <Undo className="w-4 h-4" />
        </Button>
      )}
      {onRedo && (
        <Button
          onClick={onRedo}
          disabled={!canRedo}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Redo"
        >
          <Redo className="w-4 h-4" />
        </Button>
      )}

      <div className="flex-1" />

      {/* Run */}
      {item && onRun && (
        <Button
          onClick={onRun}
          size="sm"
          variant="ghost"
          data-tutorial-id="run-workflow"
          className="h-8 w-8 p-0"
          title="Run"
        >
          <Play className="w-4 h-4" />
        </Button>
      )}

      {/* Duplicate */}
      {item && onDuplicate && (
        <Button
          onClick={onDuplicate}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Duplicate"
        >
          <Copy className="w-4 h-4" />
        </Button>
      )}

      {/* Delete */}
      {item && onDelete && (
        <Button
          onClick={onDelete}
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
