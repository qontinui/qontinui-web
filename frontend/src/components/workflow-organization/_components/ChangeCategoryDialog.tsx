import React from "react";
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

interface ChangeCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  existingCategories: string[];
  onConfirm: () => void;
  workflowCount: number;
}

export function ChangeCategoryDialog({
  open,
  onOpenChange,
  selectedCategory,
  onCategoryChange,
  existingCategories,
  onConfirm,
  workflowCount,
}: ChangeCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Category</DialogTitle>
          <DialogDescription>
            Change category for {workflowCount} workflow(s).
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="category-select">Category</Label>
          <Select value={selectedCategory} onValueChange={onCategoryChange}>
            <SelectTrigger id="category-select" className="mt-2">
              <SelectValue placeholder="Select a category..." />
            </SelectTrigger>
            <SelectContent>
              {existingCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
              <SelectItem value="Main">Main</SelectItem>
              <SelectItem value="Utility">Utility</SelectItem>
              <SelectItem value="Testing">Testing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Change Category</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
