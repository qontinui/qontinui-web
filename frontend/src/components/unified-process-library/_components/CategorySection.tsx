"use client";

import { DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trash2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Play,
} from "lucide-react";
import {
  DEFAULT_CATEGORY_NAMES,
  type Category,
} from "@/contexts/automation-context";
import type { LibraryItem } from "../types";
import { LibraryItemCard } from "./LibraryItemCard";

interface CategorySectionProps {
  category: Category;
  categoryItems: LibraryItem[];
  isCollapsed: boolean;
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  selectedItem: LibraryItem | null;
  draggedItem: LibraryItem | null;
  dragOverCategory: string | null;
  onToggleCategory: (category: string) => void;
  onToggleCategorySelection: (category: string) => void;
  onToggleAutomation: (category: Category) => void;
  onDeleteCategory: (category: string) => void;
  onCreateSequential?: (category: string) => void;
  onCreateGraph?: (category: string) => void;
  onSelectItem: (item: LibraryItem) => void;
  onToggleItemSelection: (itemId: string) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onConvertItem?: (item: LibraryItem) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, item: LibraryItem) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnter: (category: string) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>, category: string) => void;
}

export function CategorySection({
  category,
  categoryItems,
  isCollapsed,
  isSelectionMode,
  selectedIds,
  selectedItem,
  draggedItem,
  dragOverCategory,
  onToggleCategory,
  onToggleCategorySelection,
  onToggleAutomation,
  onDeleteCategory,
  onCreateSequential,
  onCreateGraph,
  onSelectItem,
  onToggleItemSelection,
  onDeleteItem,
  onConvertItem,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: CategorySectionProps) {
  const isDeletable = !DEFAULT_CATEGORY_NAMES.includes(category.name);

  return (
    <div
      key={category.name}
      className={`space-y-1 rounded-lg transition-all ${
        dragOverCategory === category.name
          ? "bg-brand-primary/10 ring-2 ring-brand-primary/50"
          : ""
      }`}
      onDragOver={onDragOver}
      onDragEnter={() => onDragEnter(category.name)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, category.name)}
    >
      <div className="flex items-center gap-1">
        {isSelectionMode && categoryItems.length > 0 && (
          <Checkbox
            checked={
              categoryItems.length > 0 &&
              categoryItems.every((item) => selectedIds.has(item.id))
            }
            onCheckedChange={() => onToggleCategorySelection(category.name)}
            className="h-3.5 w-3.5 ml-1 border-border-default data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 p-0 px-1 text-text-muted hover:text-white flex-1 justify-start"
          onClick={() => onToggleCategory(category.name)}
        >
          {isCollapsed ? (
            <>
              <ChevronRight className="w-3 h-3 mr-1" />
              <Folder className="w-3 h-3 mr-1" />
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3 mr-1" />
              <FolderOpen className="w-3 h-3 mr-1" />
            </>
          )}
          <span className="text-xs font-medium">
            {category.name} ({categoryItems.length})
          </span>
          {category.automationEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Play className="w-2.5 h-2.5 ml-1 text-brand-success" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Available for runner automation</p>
              </TooltipContent>
            </Tooltip>
          )}
        </Button>
        <div className="flex items-center gap-1">
          {!isSelectionMode && onCreateSequential && (
            <Button
              size="sm"
              className="h-6 w-6 p-0 bg-brand-primary hover:bg-brand-primary/80 text-black"
              onClick={() => onCreateSequential(category.name)}
              title={`Create sequential workflow in ${category.name}`}
            >
              <Plus className="w-3 h-3" />
            </Button>
          )}
          {!isSelectionMode && onCreateGraph && (
            <Button
              size="sm"
              className="h-6 w-6 p-0 bg-brand-success hover:bg-brand-success/80 text-black"
              onClick={() => onCreateGraph(category.name)}
              title={`Create graph workflow in ${category.name}`}
            >
              <Plus className="w-3 h-3" />
            </Button>
          )}
          {!isSelectionMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${
                    category.automationEnabled
                      ? "text-brand-success hover:text-brand-success/80"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                  onClick={() => onToggleAutomation(category)}
                  title={
                    category.automationEnabled
                      ? "Remove from runner automation"
                      : "Add to runner automation"
                  }
                >
                  <Play className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {category.automationEnabled
                    ? "Click to remove from runner automation"
                    : "Click to make available for runner automation"}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {!isSelectionMode && (
            <>
              {isDeletable ? (
                <DestructiveButton
                  size="sm"
                  className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                  onClick={() => onDeleteCategory(category.name)}
                >
                  <Trash2 className="w-3 h-3" />
                </DestructiveButton>
              ) : (
                <div className="h-6 w-6" />
              )}
            </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="ml-4 space-y-1">
          {categoryItems.length === 0 ? (
            <div className="text-xs text-text-muted italic py-2">
              Drop workflows here or use + buttons above
            </div>
          ) : (
            categoryItems.map((item) => (
              <LibraryItemCard
                key={item.id}
                item={item}
                isSelected={selectedItem?.id === item.id}
                isDraggedItem={draggedItem?.id === item.id}
                isSelectionMode={isSelectionMode}
                isChecked={selectedIds.has(item.id)}
                onSelect={onSelectItem}
                onToggleSelection={onToggleItemSelection}
                onDelete={onDeleteItem}
                onConvertItem={onConvertItem}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
