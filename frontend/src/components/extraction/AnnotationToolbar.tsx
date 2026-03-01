"use client";

import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { useAnnotationKeyboardShortcuts } from "./_hooks/useAnnotationKeyboardShortcuts";
import { ToolSelector } from "./_components/ToolSelector";
import { UndoRedoControls } from "./_components/UndoRedoControls";
import { SelectionActions } from "./_components/SelectionActions";
import { ViewToggles } from "./_components/ViewToggles";
import { ZoomControls } from "./_components/ZoomControls";
import { ReviewActions } from "./_components/ReviewActions";
import { HelpActions } from "./_components/HelpActions";
import { MoreActionsMenu } from "./_components/MoreActionsMenu";
import { ConflictWarning } from "./_components/ConflictWarning";
import { CloudSaveStatus } from "./_components/CloudSaveStatus";
import { ToolbarStatusBar } from "./_components/ToolbarStatusBar";

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
  const [showShortcuts, setShowShortcuts] = useState(false);

  const {
    selectedElementIds,
    copySelected,
    cutSelected,
    paste,
    clipboard,
    saveToBackend,
  } = useExtractionAnnotationStore();

  useAnnotationKeyboardShortcuts({
    onSave: async () => {
      const result = await saveToBackend();
      if (result.success) {
        toast.success("Annotations saved to cloud");
      } else {
        toast.error(result.error || "Failed to save annotations");
      }
    },
    onCopy: () => {
      copySelected();
      toast.success(`Copied ${selectedElementIds.length} element(s)`);
    },
    onCut: () => {
      const count = selectedElementIds.length;
      cutSelected();
      toast.success(`Cut ${count} element(s)`);
    },
    onPaste: () => {
      if (clipboard && clipboard.elements.length > 0) {
        paste();
        toast.success(`Pasted ${clipboard.elements.length} element(s)`);
      }
    },
    onShowShortcuts: () => setShowShortcuts(true),
  });

  return (
    <TooltipProvider>
      <div
        className={`flex items-center gap-1 p-2 bg-surface-raised border-b border-border-subtle flex-wrap ${className}`}
      >
        <ToolSelector />

        <Separator orientation="vertical" className="h-6 mx-2" />

        <UndoRedoControls />

        <Separator orientation="vertical" className="h-6 mx-2" />

        <SelectionActions />

        <Separator orientation="vertical" className="h-6 mx-2" />

        <ViewToggles />

        <Separator orientation="vertical" className="h-6 mx-2" />

        <ZoomControls />

        <Separator orientation="vertical" className="h-6 mx-2" />

        {selectedElementIds.length > 0 && (
          <>
            <ReviewActions />
            <Separator orientation="vertical" className="h-6 mx-2" />
          </>
        )}

        <HelpActions onShowShortcuts={() => setShowShortcuts(true)} />

        <KeyboardShortcutsDialog
          open={showShortcuts}
          onOpenChange={setShowShortcuts}
          showTrigger={false}
        />

        <MoreActionsMenu
          onExport={onExport}
          onImport={onImport}
          onBatchImport={onBatchImport}
          onShowVersionHistory={onShowVersionHistory}
        />

        <ConflictWarning />

        <CloudSaveStatus />

        <ToolbarStatusBar />
      </div>
    </TooltipProvider>
  );
}
