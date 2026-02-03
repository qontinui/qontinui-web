/**
 * Annotation Toolbar Component
 *
 * Toolbar for annotation editor with:
 * - Tool selection (Select, Draw Box, Delete, Pan)
 * - Undo/Redo actions
 * - View toggles (labels, confidence, ground truth only, review status)
 * - Zoom controls
 * - Selection actions (select all, delete selected, copy/paste)
 * - Grid/snap controls
 * - Review workflow buttons
 * - Version history
 * - Cloud sync
 */

"use client";

import { useState, useEffect } from "react";
import {
  MousePointer2,
  Square,
  Trash2,
  Undo2,
  Redo2,
  Tag,
  Percent,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Cloud,
  CloudOff,
  Loader2,
  Check,
  Copy,
  Clipboard,
  Scissors,
  Grid3x3,
  Move,
  CheckCheck,
  XCircle,
  History,
  Download,
  Upload,
  MoreHorizontal,
  Save,
  Keyboard,
  BookOpen,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  useExtractionAnnotationStore,
  type AnnotationTool,
} from "@/stores/extraction-annotation-store";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { AnnotationGuidelinesDialog } from "./AnnotationGuidelinesDialog";

interface AnnotationToolbarProps {
  className?: string;
  onExport?: () => void;
  onImport?: () => void;
  onBatchImport?: () => void;
  onShowVersionHistory?: () => void;
}

export function AnnotationToolbar({
  className,
  onExport,
  onImport,
  onBatchImport,
  onShowVersionHistory,
}: AnnotationToolbarProps) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const store = useExtractionAnnotationStore();
  const {
    activeTool,
    setActiveTool,
    showLabels,
    setShowLabels,
    showConfidence,
    setShowConfidence,
    showOnlyGroundTruth,
    setShowOnlyGroundTruth,
    showReviewStatus,
    setShowReviewStatus,
    zoom,
    setZoom,
    setPan,
    canUndo,
    canRedo,
    undo,
    redo,
    selectedElementIds,
    deleteElements,
    selectAll,
    deselectAll,
    copySelected,
    cutSelected,
    paste,
    clipboard,
    extractionId,
    isSaving,
    hasUnsavedChanges,
    lastSavedAt,
    saveToBackend,
    grid,
    setGridEnabled,
    autoSave,
    setAutoSaveEnabled,
    bulkApprove,
    bulkReject,
    saveVersion,
    elements,
    hasSelection,
    conflict,
    resolveConflict,
  } = store;

  const tools: { id: AnnotationTool; icon: React.ReactNode; label: string }[] =
    [
      {
        id: "select",
        icon: <MousePointer2 className="h-4 w-4" />,
        label: "Select (S)",
      },
      {
        id: "draw",
        icon: <Square className="h-4 w-4" />,
        label: "Draw Box (D)",
      },
      {
        id: "delete",
        icon: <Trash2 className="h-4 w-4" />,
        label: "Delete (X)",
      },
      { id: "pan", icon: <Move className="h-4 w-4" />, label: "Pan (P)" },
    ];

  const handleZoomIn = () => setZoom(zoom * 1.2);
  const handleZoomOut = () => setZoom(zoom / 1.2);
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleDeleteSelected = () => {
    if (selectedElementIds.length > 0) {
      deleteElements(selectedElementIds);
      toast.success(`Deleted ${selectedElementIds.length} element(s)`);
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    const result = await saveToBackend();
    if (result.success) {
      toast.success("Annotations saved to cloud");
    } else {
      setSaveError(result.error || "Failed to save");
      toast.error(result.error || "Failed to save annotations");
    }
  };

  const handleCopy = () => {
    copySelected();
    toast.success(`Copied ${selectedElementIds.length} element(s)`);
  };

  const handleCut = () => {
    const count = selectedElementIds.length;
    cutSelected();
    toast.success(`Cut ${count} element(s)`);
  };

  const handlePaste = () => {
    if (clipboard && clipboard.elements.length > 0) {
      paste();
      toast.success(`Pasted ${clipboard.elements.length} element(s)`);
    }
  };

  const handleSaveVersion = () => {
    saveVersion();
    toast.success("Version saved");
  };

  const formatLastSaved = () => {
    if (!lastSavedAt) return null;
    const diff = Date.now() - lastSavedAt;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(lastSavedAt).toLocaleTimeString();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+S - Save
      if (isCtrlOrCmd && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges && extractionId) {
          handleSave();
        }
        return;
      }

      // Ctrl+Z - Undo
      if (isCtrlOrCmd && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) {
          undo();
        }
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z - Redo
      if (isCtrlOrCmd && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (canRedo()) {
          redo();
        }
        return;
      }

      // Ctrl+C - Copy
      if (isCtrlOrCmd && e.key === "c" && !e.shiftKey) {
        if (hasSelection()) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }

      // Ctrl+X - Cut
      if (isCtrlOrCmd && e.key === "x") {
        if (hasSelection()) {
          e.preventDefault();
          handleCut();
        }
        return;
      }

      // Ctrl+V - Paste
      if (isCtrlOrCmd && e.key === "v") {
        if (clipboard && clipboard.elements.length > 0) {
          e.preventDefault();
          handlePaste();
        }
        return;
      }

      // Ctrl+A - Select All
      if (isCtrlOrCmd && e.key === "a") {
        e.preventDefault();
        selectAll();
        return;
      }

      // Escape - Deselect
      if (e.key === "Escape") {
        deselectAll();
        return;
      }

      // ? - Show keyboard shortcuts
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // Delete key - Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          deleteElements(selectedElementIds);
        }
        return;
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case "s":
          setActiveTool("select");
          break;
        case "d":
          setActiveTool("draw");
          break;
        case "x":
          setActiveTool("delete");
          break;
        case "p":
          setActiveTool("pan");
          break;
        case "g":
          if (isCtrlOrCmd) {
            e.preventDefault();
            setGridEnabled(!grid.enabled);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave, handleCopy, handleCut, handlePaste are intentionally excluded to avoid re-registering on every render
  }, [
    hasUnsavedChanges,
    extractionId,
    hasSelection,
    clipboard,
    grid.enabled,
    selectAll,
    deselectAll,
    setActiveTool,
    setGridEnabled,
    canUndo,
    canRedo,
    undo,
    redo,
    selectedElementIds,
    deleteElements,
  ]);

  return (
    <TooltipProvider>
      <div
        className={`flex items-center gap-1 p-2 bg-surface-raised border-b border-border-subtle flex-wrap ${className}`}
      >
        {/* Tool Selection */}
        <div className="flex items-center gap-1">
          {tools.map((tool) => (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === tool.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTool(tool.id)}
                  className={
                    activeTool === tool.id
                      ? "bg-[#9B59B6]/20 text-[#9B59B6] hover:bg-[#9B59B6]/30"
                      : ""
                  }
                >
                  {tool.icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{tool.label}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={undo}
                disabled={!canUndo()}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Undo (Ctrl+Z)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={redo}
                disabled={!canRedo()}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Redo (Ctrl+Y)</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Selection Actions */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                disabled={selectedElementIds.length === 0}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Copy (Ctrl+C)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCut}
                disabled={selectedElementIds.length === 0}
              >
                <Scissors className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Cut (Ctrl+X)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePaste}
                disabled={!clipboard || clipboard.elements.length === 0}
              >
                <Clipboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Paste (Ctrl+V)</p>
            </TooltipContent>
          </Tooltip>

          {selectedElementIds.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteSelected}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Delete Selected (Del)</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* View Toggles */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={showLabels}
                onPressedChange={setShowLabels}
                className={showLabels ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""}
              >
                <Tag className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Show Labels</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={showConfidence}
                onPressedChange={setShowConfidence}
                className={
                  showConfidence ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""
                }
              >
                <Percent className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Show Confidence</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={showOnlyGroundTruth}
                onPressedChange={setShowOnlyGroundTruth}
                className={
                  showOnlyGroundTruth ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""
                }
              >
                <CheckCircle2 className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Ground Truth Only</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={showReviewStatus}
                onPressedChange={setShowReviewStatus}
                className={
                  showReviewStatus ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""
                }
              >
                <CheckCheck className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Show Review Status</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={grid.enabled}
                onPressedChange={setGridEnabled}
                className={grid.enabled ? "bg-[#9B59B6]/20 text-[#9B59B6]" : ""}
              >
                <Grid3x3 className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Snap to Grid (Ctrl+G)</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleZoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Zoom Out</p>
            </TooltipContent>
          </Tooltip>

          <span className="text-xs text-text-muted min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleZoomIn}>
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Zoom In</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleResetView}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Reset View</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-2" />

        {/* Review Actions */}
        {selectedElementIds.length > 0 && (
          <>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={bulkApprove}
                    className="text-green-600 hover:text-green-600"
                  >
                    <CheckCheck className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Approve Selected</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => bulkReject()}
                    className="text-red-600 hover:text-red-600"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Reject Selected</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <Separator orientation="vertical" className="h-6 mx-2" />
          </>
        )}

        {/* Help Actions */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <AnnotationGuidelinesDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-text-muted hover:text-[#9B59B6]"
                  >
                    <BookOpen className="h-4 w-4" />
                  </Button>
                }
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Annotation Guidelines</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowShortcuts(true)}
                className="text-text-muted hover:text-[#9B59B6]"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Keyboard Shortcuts (?)</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <KeyboardShortcutsDialog
          open={showShortcuts}
          onOpenChange={setShowShortcuts}
          showTrigger={false}
        />

        {/* More Actions Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={selectAll}>
              Select All (Ctrl+A)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={deselectAll}>
              Deselect All (Esc)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSaveVersion}>
              <Save className="h-4 w-4 mr-2" />
              Save Version
            </DropdownMenuItem>
            {onShowVersionHistory && (
              <DropdownMenuItem onClick={onShowVersionHistory}>
                <History className="h-4 w-4 mr-2" />
                Version History
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {onImport && (
              <DropdownMenuItem onClick={onImport}>
                <Upload className="h-4 w-4 mr-2" />
                Import Annotations
              </DropdownMenuItem>
            )}
            {onBatchImport && (
              <DropdownMenuItem onClick={onBatchImport}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Batch Import from Folder
              </DropdownMenuItem>
            )}
            {onExport && (
              <DropdownMenuItem onClick={onExport}>
                <Download className="h-4 w-4 mr-2" />
                Export Training Data
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Auto-save: {autoSave.enabled ? "On" : "Off"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setAutoSaveEnabled(true)}>
                  Enable Auto-save
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAutoSaveEnabled(false)}>
                  Disable Auto-save
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Conflict Warning */}
        {conflict.hasConflict && (
          <>
            <Separator orientation="vertical" className="h-6 mx-2" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="animate-pulse"
                >
                  <CloudOff className="h-4 w-4 mr-1" />
                  Conflict
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => resolveConflict("keep_local")}>
                  Keep Local Changes
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => resolveConflict("keep_remote")}
                >
                  Use Remote Version
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => resolveConflict("merge")}>
                  Merge Both
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Save to Cloud */}
        {extractionId && !conflict.hasConflict && (
          <>
            <Separator orientation="vertical" className="h-6 mx-2" />
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={hasUnsavedChanges ? "default" : "ghost"}
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving || !hasUnsavedChanges}
                    className={
                      hasUnsavedChanges
                        ? "bg-[#9B59B6] hover:bg-[#9B59B6]/90"
                        : ""
                    }
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : hasUnsavedChanges ? (
                      <Cloud className="h-4 w-4" />
                    ) : (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    {isSaving
                      ? "Saving..."
                      : hasUnsavedChanges
                        ? "Save to Cloud (Ctrl+S)"
                        : "All changes saved"}
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Sync status */}
              <div className="flex items-center gap-1 text-xs text-text-muted">
                {saveError ? (
                  <span className="flex items-center gap-1 text-destructive">
                    <CloudOff className="h-3 w-3" />
                    Error
                  </span>
                ) : lastSavedAt ? (
                  <span className="opacity-60">Saved {formatLastSaved()}</span>
                ) : autoSave.enabled ? (
                  <span className="opacity-60">Auto-save on</span>
                ) : null}
              </div>
            </div>
          </>
        )}

        {/* Element count & selection count */}
        <div className="ml-auto text-xs text-text-muted flex items-center gap-2">
          {selectedElementIds.length > 0 && (
            <span className="font-mono text-[#9B59B6]">
              {selectedElementIds.length} selected
            </span>
          )}
          <span className="font-mono">
            {elements.length} element{elements.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
