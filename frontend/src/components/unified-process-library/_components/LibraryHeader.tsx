"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, FolderOpen, Plus, CheckSquare, X } from "lucide-react";

interface LibraryHeaderProps {
  isSelectionMode: boolean;
  selectedCount: number;
  showNewCategoryInput: boolean;
  newCategoryName: string;
  onToggleSelectionMode: () => void;
  onBatchDelete: () => void;
  onShowNewCategoryInput: () => void;
  onNewCategoryNameChange: (name: string) => void;
  onAddCategory: () => void;
  onCancelNewCategory: () => void;
}

export function LibraryHeader({
  isSelectionMode,
  selectedCount,
  showNewCategoryInput,
  newCategoryName,
  onToggleSelectionMode,
  onBatchDelete,
  onShowNewCategoryInput,
  onNewCategoryNameChange,
  onAddCategory,
  onCancelNewCategory,
}: LibraryHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-muted uppercase tracking-wide">
          Automation Library
        </h3>
        <div className="flex items-center gap-1">
          {isSelectionMode ? (
            <>
              <span className="text-xs text-text-muted">
                {selectedCount} selected
              </span>
              {selectedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  onClick={onBatchDelete}
                  title="Delete selected workflows"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-text-muted hover:text-white"
                onClick={onToggleSelectionMode}
                title="Cancel selection"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-text-muted hover:text-brand-primary flex items-center gap-1"
                onClick={onToggleSelectionMode}
                title="Select multiple workflows"
              >
                <CheckSquare className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-text-muted hover:text-brand-primary flex items-center gap-1"
                onClick={onShowNewCategoryInput}
                title="Add new category"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <Plus className="w-3 h-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {showNewCategoryInput && (
        <div className="flex gap-1">
          <Input
            value={newCategoryName}
            onChange={(e) => onNewCategoryNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddCategory();
              if (e.key === "Escape") onCancelNewCategory();
            }}
            placeholder="Category name..."
            className="h-7 text-xs bg-transparent border-border-default"
          />
          <Button size="sm" className="h-7 px-2" onClick={onAddCategory}>
            Add
          </Button>
        </div>
      )}
    </>
  );
}
