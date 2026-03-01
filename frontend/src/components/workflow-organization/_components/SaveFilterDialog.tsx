/**
 * SaveFilterDialog Component
 *
 * Dialog for saving the current filter configuration with a name.
 */

import React from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

export interface SaveFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filterName: string;
  setFilterName: (name: string) => void;
  onSave: () => void;
}

export function SaveFilterDialog({
  open,
  onOpenChange,
  filterName,
  setFilterName,
  onSave,
}: SaveFilterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Filter</DialogTitle>
          <DialogDescription>
            Save the current filter configuration for quick access later.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="filter-name">Filter Name</Label>
          <Input
            id="filter-name"
            placeholder="e.g., Complex workflows with tests"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            className="mt-2"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save Filter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
