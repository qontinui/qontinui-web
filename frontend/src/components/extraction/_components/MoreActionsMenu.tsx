"use client";

import {
  MoreHorizontal,
  Save,
  History,
  Upload,
  FolderOpen,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

interface MoreActionsMenuProps {
  onExport?: () => void;
  onImport?: () => void;
  onBatchImport?: () => void;
  onShowVersionHistory?: () => void;
}

export function MoreActionsMenu({
  onExport,
  onImport,
  onBatchImport,
  onShowVersionHistory,
}: MoreActionsMenuProps) {
  const { selectAll, deselectAll, saveVersion, autoSave, setAutoSaveEnabled } =
    useExtractionAnnotationStore();

  const handleSaveVersion = () => {
    saveVersion();
    toast.success("Version saved");
  };

  return (
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
  );
}
