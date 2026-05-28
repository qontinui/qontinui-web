"use client";

import { Copy, Scissors, Clipboard, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

export function SelectionActions() {
  const {
    selectedElementIds,
    clipboard,
    copySelected,
    cutSelected,
    paste,
    deleteElements,
  } = useExtractionAnnotationStore();

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

  const handleDeleteSelected = () => {
    if (selectedElementIds.length > 0) {
      deleteElements(selectedElementIds);
      toast.success(`Deleted ${selectedElementIds.length} element(s)`);
    }
  };

  return (
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
            <DestructiveButton
              size="sm"
              onClick={handleDeleteSelected}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </DestructiveButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Delete Selected (Del)</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
