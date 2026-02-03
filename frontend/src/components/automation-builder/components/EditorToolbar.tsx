/**
 * EditorToolbar Component
 *
 * Provides common actions for the automation builder:
 * - Run (primary action)
 * - More menu with secondary actions (Share, Verify, Export, Import, Duplicate, Delete)
 *
 * Adapts its appearance and actions based on the current mode and item type.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Trash2,
  Copy,
  Play,
  Download,
  Upload,
  Share2,
  FolderDown,
  ClipboardCheck,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryItem, BuilderMode } from "../types";

export interface EditorToolbarProps {
  item: LibraryItem | null;
  mode: BuilderMode;
  onSave?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onConvert?: () => void;
  onRun?: () => void;
  onTest?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onExportProject?: () => void;
  onVerifyProject?: () => void;
  onShare?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  isSaving?: boolean;
  className?: string;
}

export function EditorToolbar({
  item,
  mode,
  onDelete,
  onDuplicate,
  onRun,
  onExport,
  onImport,
  onExportProject,
  onVerifyProject,
  onShare,
  className,
}: EditorToolbarProps) {
  const isSequential = mode === "sequential";

  // Color theme based on mode
  const accentColor = isSequential ? "#00D9FF" : "#00FF88";

  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-canvas",
        className
      )}
    >
      {/* Left side - Primary action */}
      <div className="flex items-center gap-2">
        {/* Run Button - Primary action */}
        {item && onRun && (
          <Button
            onClick={onRun}
            size="sm"
            data-tutorial-id="run-workflow"
            data-ui-id="automation-toolbar-run-btn"
            style={{
              backgroundColor: `${accentColor}22`,
              borderColor: `${accentColor}44`,
              color: accentColor,
            }}
            className="border transition-colors"
          >
            <Play className="w-4 h-4 mr-2" />
            Run
          </Button>
        )}

        {!item && (
          <span className="text-sm text-text-muted">
            Select a workflow to edit
          </span>
        )}
      </div>

      {/* Right side - Secondary actions in dropdown */}
      <div className="flex items-center gap-2">
        {/* Project-level actions (always available) */}
        {onVerifyProject && (
          <Button
            onClick={onVerifyProject}
            size="sm"
            variant="ghost"
            className="text-text-muted hover:text-white hover:bg-surface-raised"
            title="Verify project configuration"
            data-ui-id="automation-toolbar-verify-btn"
          >
            <ClipboardCheck className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Verify</span>
          </Button>
        )}

        {onExportProject && (
          <Button
            onClick={onExportProject}
            size="sm"
            variant="ghost"
            className="text-text-muted hover:text-white hover:bg-surface-raised"
            title="Export entire project for qontinui-runner"
            data-ui-id="automation-toolbar-exportproject-btn"
          >
            <FolderDown className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        )}

        {/* Workflow-specific actions in dropdown */}
        {item && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-text-muted hover:text-white hover:bg-surface-raised"
                data-ui-id="automation-toolbar-more-btn"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {onShare && (
                <DropdownMenuItem
                  onClick={onShare}
                  data-ui-id="automation-toolbar-share-btn"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </DropdownMenuItem>
              )}

              {onShare && <DropdownMenuSeparator />}

              {onExport && (
                <DropdownMenuItem
                  onClick={onExport}
                  data-ui-id="automation-toolbar-export-btn"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export Workflow
                </DropdownMenuItem>
              )}

              {onImport && (
                <DropdownMenuItem
                  onClick={onImport}
                  data-ui-id="automation-toolbar-import-btn"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Import Workflow
                </DropdownMenuItem>
              )}

              {(onExport || onImport) && <DropdownMenuSeparator />}

              {onDuplicate && (
                <DropdownMenuItem
                  onClick={onDuplicate}
                  data-ui-id="automation-toolbar-duplicate-btn"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
              )}

              {onDelete && (
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-red-400 focus:text-red-300"
                  data-ui-id="automation-toolbar-delete-btn"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
  onDelete,
  onDuplicate,
  onRun,
  className,
}: CompactToolbarProps) {
  const isSequential = mode === "sequential";
  const accentColor = isSequential ? "#00D9FF" : "#00FF88";

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle bg-surface-canvas",
        className
      )}
    >
      <div className="flex-1" />

      {/* Run */}
      {item && onRun && (
        <Button
          onClick={onRun}
          size="sm"
          variant="ghost"
          data-tutorial-id="run-workflow"
          className="h-8 w-8 p-0"
          style={{ color: accentColor }}
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
