/**
 * Version History Dialog
 *
 * Dialog for viewing and restoring annotation versions.
 */

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { History, Trash2, RotateCcw, Check } from "lucide-react";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
}: VersionHistoryDialogProps) {
  const { versions, currentVersionId, loadVersion, deleteVersion } =
    useExtractionAnnotationStore();

  const handleRestore = (versionId: string) => {
    loadVersion(versionId);
    toast.success("Version restored");
    onOpenChange(false);
  };

  const handleDelete = (versionId: string) => {
    deleteVersion(versionId);
    toast.success("Version deleted");
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return `${Math.floor(diff / 86400000)} days ago`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </DialogTitle>
          <DialogDescription>
            View and restore previous versions of your annotations.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          {versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No versions saved yet.</p>
              <p className="text-sm mt-1">
                Use &quot;Save Version&quot; from the toolbar to create a
                snapshot.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {versions
                .slice()
                .reverse()
                .map((version) => (
                  <div
                    key={version.id}
                    className={`p-3 rounded-lg border ${
                      version.id === currentVersionId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    } transition-colors`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {formatRelativeTime(version.timestamp)}
                          </span>
                          {version.id === currentVersionId && (
                            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(version.timestamp)}
                        </p>
                        {version.comment && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {version.comment}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {version.elements.length} element
                          {version.elements.length !== 1 ? "s" : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {version.id !== currentVersionId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRestore(version.id)}
                            title="Restore this version"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        {version.id === currentVersionId && (
                          <Check className="h-4 w-4 text-primary mr-2" />
                        )}
                        <DestructiveButton
                          size="sm"
                          onClick={() => handleDelete(version.id)}
                          className="text-destructive hover:text-destructive"
                          title="Delete this version"
                        >
                          <Trash2 className="h-4 w-4" />
                        </DestructiveButton>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
