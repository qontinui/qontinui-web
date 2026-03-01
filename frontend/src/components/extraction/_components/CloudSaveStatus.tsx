"use client";

import { useState } from "react";
import { Cloud, CloudOff, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

function formatLastSaved(lastSavedAt: number | null): string | null {
  if (!lastSavedAt) return null;
  const diff = Date.now() - lastSavedAt;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(lastSavedAt).toLocaleTimeString();
}

export function CloudSaveStatus() {
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    extractionId,
    isSaving,
    hasUnsavedChanges,
    lastSavedAt,
    saveToBackend,
    autoSave,
    conflict,
  } = useExtractionAnnotationStore();

  if (!extractionId || conflict.hasConflict) return null;

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

  return (
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
                hasUnsavedChanges ? "bg-[#9B59B6] hover:bg-[#9B59B6]/90" : ""
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
            <span className="opacity-60">
              Saved {formatLastSaved(lastSavedAt)}
            </span>
          ) : autoSave.enabled ? (
            <span className="opacity-60">Auto-save on</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
