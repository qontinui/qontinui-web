import React from "react";
import { X } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Badge } from "../../ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

interface AddTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newTagInput: string;
  onNewTagInputChange: (value: string) => void;
  tagsToAdd: string[];
  onAddNewTag: () => void;
  onRemoveTagFromList: (tag: string) => void;
  onConfirm: () => void;
  workflowCount: number;
}

export function AddTagsDialog({
  open,
  onOpenChange,
  newTagInput,
  onNewTagInputChange,
  tagsToAdd,
  onAddNewTag,
  onRemoveTagFromList,
  onConfirm,
  workflowCount,
}: AddTagsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Tags</DialogTitle>
          <DialogDescription>
            Add tags to {workflowCount} workflow(s).
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tag-input">New Tag</Label>
            <div className="flex gap-2">
              <Input
                id="tag-input"
                placeholder="Enter tag name..."
                value={newTagInput}
                onChange={(e) => onNewTagInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddNewTag();
                  }
                }}
              />
              <Button onClick={onAddNewTag}>Add</Button>
            </div>
          </div>

          {tagsToAdd.length > 0 && (
            <div className="space-y-2">
              <Label>Tags to Add</Label>
              <div className="flex flex-wrap gap-2">
                {tagsToAdd.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      onClick={() => onRemoveTagFromList(tag)}
                      className="ml-2 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={tagsToAdd.length === 0}>
            Add Tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
