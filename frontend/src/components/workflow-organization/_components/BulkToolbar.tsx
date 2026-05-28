import React from "react";
import {
  X,
  Folder,
  Tag,
  MoreHorizontal,
  FolderOpen,
  TagIcon,
  Trash2,
  Download,
  Copy,
  PlayCircle,
} from "lucide-react";
import { Button } from "../../ui/button";
import { DestructiveButton } from "../../ui/destructive-button";
import { Badge } from "../../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { cn } from "../../../lib/utils";

interface BulkToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onMoveClick: () => void;
  onAddTagsClick: () => void;
  onRemoveTagsClick: () => void;
  onChangeCategoryClick: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onRunTests: () => void;
  onDeleteClick: () => void;
  className?: string;
}

export function BulkToolbar({
  selectedCount,
  onClearSelection,
  onMoveClick,
  onAddTagsClick,
  onRemoveTagsClick,
  onChangeCategoryClick,
  onDuplicate,
  onExport,
  onRunTests,
  onDeleteClick,
  className,
}: BulkToolbarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className
      )}
    >
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge variant="default" className="text-sm px-3 py-1">
              {selectedCount} selected
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="h-8"
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onMoveClick}>
              <Folder className="h-4 w-4 mr-2" />
              Move
            </Button>

            <Button variant="outline" size="sm" onClick={onAddTagsClick}>
              <Tag className="h-4 w-4 mr-2" />
              Add Tags
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4 mr-2" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onRemoveTagsClick}>
                  <TagIcon className="h-4 w-4 mr-2" />
                  Remove Tags
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onChangeCategoryClick}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Change Category
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRunTests}>
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Run Tests
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <DestructiveButton
                    onClick={onDeleteClick}
                    className="w-full justify-start text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DestructiveButton>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
