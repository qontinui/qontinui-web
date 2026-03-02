import React from "react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

interface RemoveTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingTags: string[];
  tagsToRemove: string[];
  onToggleRemoveTag: (tag: string) => void;
  onConfirm: () => void;
  workflowCount: number;
}

export function RemoveTagsDialog({
  open,
  onOpenChange,
  existingTags,
  tagsToRemove,
  onToggleRemoveTag,
  onConfirm,
  workflowCount,
}: RemoveTagsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Tags</DialogTitle>
          <DialogDescription>
            Select tags to remove from {workflowCount} workflow(s).
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {existingTags.length > 0 ? (
            <div className="space-y-2">
              <Label>Existing Tags</Label>
              <div className="space-y-1 max-h-60 overflow-y-auto border rounded-md p-2">
                {existingTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={tagsToRemove.includes(tag)}
                      onChange={() => onToggleRemoveTag(tag)}
                      className="rounded"
                    />
                    <span className="text-sm">{tag}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              No tags to remove
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={tagsToRemove.length === 0}
            variant="destructive"
          >
            Remove Tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
