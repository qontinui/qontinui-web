import React from "react";
import { WorkflowFolder } from "../types";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: WorkflowFolder[];
  selectedFolderId: string;
  onFolderChange: (folderId: string) => void;
  onConfirm: () => void;
  workflowCount: number;
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  folders,
  selectedFolderId,
  onFolderChange,
  onConfirm,
  workflowCount,
}: MoveToFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
          <DialogDescription>
            Select a folder to move {workflowCount} workflow(s) to.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="folder-select">Folder</Label>
          <Select value={selectedFolderId} onValueChange={onFolderChange}>
            <SelectTrigger id="folder-select" className="mt-2">
              <SelectValue placeholder="Select a folder..." />
            </SelectTrigger>
            <SelectContent>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
