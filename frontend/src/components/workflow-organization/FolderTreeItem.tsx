/**
 * Folder Tree Item Component
 *
 * Individual folder node in the tree with drag-and-drop support,
 * inline editing, and context menu.
 */

import React from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Edit2,
  Trash2,
  Palette,
  ImageIcon,
  Move,
} from "lucide-react";
import { FolderTreeNode, DragItem } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDragSource } from "@qontinui/ui-bridge";
import { cn } from "../../lib/utils";

export interface FolderTreeItemProps {
  node: FolderTreeNode;
  isSelected: boolean;
  isEditing: boolean;
  editingName: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onStartEdit: (id: string, name: string) => void;
  onFinishEdit: (save: boolean) => void;
  onEditingNameChange: (name: string) => void;
  onDelete: (id: string) => void;
  onCreateSubfolder: (parentId: string) => void;
  onChangeColor: (id: string) => void;
  onChangeIcon: (id: string) => void;
  onMove: (id: string) => void;
}

export function FolderTreeItem({
  node,
  isSelected,
  isEditing,
  editingName,
  onSelect,
  onToggle,
  onStartEdit,
  onFinishEdit,
  onEditingNameChange,
  onDelete,
  onCreateSubfolder,
  onChangeColor,
  onChangeIcon,
  onMove,
}: FolderTreeItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    data: {
      type: "folder",
      id: node.id,
      parentId: node.parentId,
    } as DragItem,
  });
  useDragSource(node.id, { dataType: "folder" });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const indentWidth = node.depth * 20;
  const hasChildren = node.children.length > 0;

  const FolderIcon = node.expanded ? FolderOpen : Folder;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer transition-colors",
        isSelected && "bg-accent",
        !isSelected && "hover:bg-accent/50"
      )}
      onDoubleClick={() => hasChildren && onToggle(node.id)}
      {...attributes}
      {...listeners}
    >
      <div
        className="flex items-center flex-1 gap-1"
        style={{ paddingLeft: indentWidth }}
      >
        {/* Expand/collapse button */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="flex-shrink-0 p-0.5 hover:bg-accent rounded"
            aria-label={node.expanded ? "Collapse folder" : "Expand folder"}
          >
            {node.expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="w-5" /> // Spacer for alignment
        )}

        {/* Folder icon */}
        <FolderIcon
          className="h-4 w-4 flex-shrink-0"
          style={{ color: node.color || undefined }}
        />

        {/* Folder name or edit input */}
        {isEditing ? (
          <Input
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onBlur={() => onFinishEdit(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onFinishEdit(true);
              } else if (e.key === "Escape") {
                onFinishEdit(false);
              }
            }}
            className="h-6 py-0 px-1 text-sm flex-1"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(node.id);
            }}
            className="flex-1 text-left text-sm font-medium truncate"
          >
            {node.name}
          </button>
        )}

        {/* Workflow count badge */}
        {node.totalWorkflowCount > 0 && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
            {node.totalWorkflowCount}
          </Badge>
        )}

        {/* Context menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onCreateSubfolder(node.id);
              }}
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              New Subfolder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit(node.id, node.name);
              }}
            >
              <Edit2 className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onChangeColor(node.id);
              }}
            >
              <Palette className="h-4 w-4 mr-2" />
              Change Color
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onChangeIcon(node.id);
              }}
            >
              <ImageIcon className="h-4 w-4 mr-2" />
              Change Icon
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onMove(node.id);
              }}
            >
              <Move className="h-4 w-4 mr-2" />
              Move Folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.id);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
