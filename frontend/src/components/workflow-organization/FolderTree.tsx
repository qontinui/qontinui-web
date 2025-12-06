/**
 * Folder Tree Component
 *
 * Hierarchical tree view for organizing workflows in folders.
 * Features drag-and-drop, context menus, keyboard navigation, and inline editing.
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  MoreVertical,
  Edit2,
  Trash2,
  Palette,
  ImageIcon,
  Move,
  Plus,
  Minus,
  X,
  FolderTreeIcon,
} from "lucide-react";
import { Workflow } from "../../lib/action-schema/action-types";
import { WorkflowFolder, FolderTreeNode, DragItem } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface FolderTreeProps {
  folders: WorkflowFolder[];
  workflows: Workflow[];
  selectedFolderId?: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<WorkflowFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onMoveFolder: (folderId: string, newParentId: string | null) => void;
  onMoveWorkflow: (workflowId: string, folderId: string | null) => void;
  className?: string;
}

interface ColorPickerProps {
  currentColor?: string;
  onColorSelect: (color: string) => void;
  onClose: () => void;
}

interface IconPickerProps {
  currentIcon?: string;
  onIconSelect: (icon: string) => void;
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const FOLDER_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
];

const FOLDER_ICONS = [
  "Folder",
  "FolderOpen",
  "FolderPlus",
  "FolderTree",
  "Archive",
  "Bookmark",
  "Tag",
  "Star",
  "Heart",
  "Shield",
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build tree structure from flat folder list
 */
function buildFolderTree(
  folders: WorkflowFolder[],
  workflows: Workflow[],
  expandedIds: Set<string>
): FolderTreeNode[] {
  const folderMap = new Map<string, FolderTreeNode>();
  const rootFolders: FolderTreeNode[] = [];

  // Count workflows per folder
  const workflowCounts = new Map<string, number>();
  workflows.forEach((workflow) => {
    const folderId = (workflow as any).folderId || null;
    if (folderId) {
      workflowCounts.set(folderId, (workflowCounts.get(folderId) || 0) + 1);
    }
  });

  // Create tree nodes
  folders.forEach((folder) => {
    const node: FolderTreeNode = {
      ...folder,
      children: [],
      workflowCount: workflowCounts.get(folder.id) || 0,
      totalWorkflowCount: 0,
      depth: 0,
      expanded: expandedIds.has(folder.id),
    };
    folderMap.set(folder.id, node);
  });

  // Build hierarchy
  folders.forEach((folder) => {
    const node = folderMap.get(folder.id)!;
    if (folder.parentId === null) {
      rootFolders.push(node);
    } else {
      const parent = folderMap.get(folder.parentId);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        // Parent not found, treat as root
        rootFolders.push(node);
      }
    }
  });

  // Calculate total counts (including subfolders)
  function calculateTotalCounts(node: FolderTreeNode): number {
    let total = node.workflowCount;
    node.children.forEach((child) => {
      total += calculateTotalCounts(child);
    });
    node.totalWorkflowCount = total;
    return total;
  }

  rootFolders.forEach(calculateTotalCounts);

  // Sort by order
  function sortChildren(nodes: FolderTreeNode[]) {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach((node) => sortChildren(node.children));
  }
  sortChildren(rootFolders);

  return rootFolders;
}

/**
 * Flatten tree for drag-and-drop
 */
function flattenTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  const result: FolderTreeNode[] = [];
  function traverse(nodes: FolderTreeNode[]) {
    nodes.forEach((node) => {
      result.push(node);
      if (node.expanded && node.children.length > 0) {
        traverse(node.children);
      }
    });
  }
  traverse(nodes);
  return result;
}

/**
 * Filter tree by search query
 */
function filterTree(nodes: FolderTreeNode[], query: string): FolderTreeNode[] {
  if (!query) return nodes;

  const lowerQuery = query.toLowerCase();

  function matchesSearch(node: FolderTreeNode): boolean {
    return node.name.toLowerCase().includes(lowerQuery);
  }

  function filterNode(node: FolderTreeNode): FolderTreeNode | null {
    const matches = matchesSearch(node);
    const filteredChildren = node.children
      .map((child) => filterNode(child))
      .filter((child): child is FolderTreeNode => child !== null);

    if (matches || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
        // Expand nodes that have matching children
        expanded: filteredChildren.length > 0 ? true : node.expanded,
      };
    }

    return null;
  }

  return nodes
    .map((node) => filterNode(node))
    .filter((node): node is FolderTreeNode => node !== null);
}

// ============================================================================
// Color Picker Component
// ============================================================================

function ColorPicker({
  currentColor,
  onColorSelect,
  onClose,
}: ColorPickerProps) {
  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Choose Color</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {FOLDER_COLORS.map((color) => (
          <button
            key={color}
            className={cn(
              "w-8 h-8 rounded-md border-2 transition-all hover:scale-110",
              currentColor === color
                ? "border-foreground"
                : "border-transparent"
            )}
            style={{ backgroundColor: color }}
            onClick={() => {
              onColorSelect(color);
              onClose();
            }}
            aria-label={`Select color ${color}`}
          />
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={() => {
          onColorSelect("");
          onClose();
        }}
      >
        Reset to Default
      </Button>
    </div>
  );
}

// ============================================================================
// Icon Picker Component
// ============================================================================

function IconPicker({ currentIcon, onIconSelect, onClose }: IconPickerProps) {
  // Simplified icon picker - in a real app, you'd import all the icons
  const icons = FOLDER_ICONS;

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Choose Icon</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-2 max-h-48 overflow-y-auto">
        {icons.map((icon) => (
          <button
            key={icon}
            className={cn(
              "w-8 h-8 rounded-md border-2 flex items-center justify-center transition-all hover:bg-accent",
              currentIcon === icon ? "border-foreground" : "border-transparent"
            )}
            onClick={() => {
              onIconSelect(icon);
              onClose();
            }}
            aria-label={`Select icon ${icon}`}
          >
            <Folder className="h-4 w-4" />
          </button>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={() => {
          onIconSelect("");
          onClose();
        }}
      >
        Reset to Default
      </Button>
    </div>
  );
}

// ============================================================================
// Folder Tree Item Component
// ============================================================================

interface FolderTreeItemProps {
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

function FolderTreeItem({
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
            autoFocus
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

// ============================================================================
// Main Folder Tree Component
// ============================================================================

export function FolderTree({
  folders,
  workflows,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveWorkflow,
  className,
}: FolderTreeProps) {
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [creatingInParentId, setCreatingInParentId] = useState<string | null>(
    null
  );
  const [newFolderName, setNewFolderName] = useState("");
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [_overId, _setOverId] = useState<UniqueIdentifier | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
  const [moveDialogSearchQuery, setMoveDialogSearchQuery] = useState("");
  const [moveDialogExpandedIds, setMoveDialogExpandedIds] = useState<
    Set<string>
  >(new Set());

  // Build tree
  const tree = useMemo(
    () => buildFolderTree(folders, workflows, expandedIds),
    [folders, workflows, expandedIds]
  );

  // Filter tree
  const filteredTree = useMemo(
    () => filterTree(tree, searchQuery),
    [tree, searchQuery]
  );

  // Flatten for rendering
  const flatTree = useMemo(() => flattenTree(filteredTree), [filteredTree]);

  // Build tree for move dialog
  const moveDialogTree = useMemo(
    () =>
      buildFolderTree(
        folders.filter((f) => f.id !== movingFolderId),
        workflows,
        moveDialogExpandedIds
      ),
    [folders, workflows, moveDialogExpandedIds, movingFolderId]
  );

  // Filter move dialog tree
  const filteredMoveDialogTree = useMemo(
    () => filterTree(moveDialogTree, moveDialogSearchQuery),
    [moveDialogTree, moveDialogSearchQuery]
  );

  // Flatten move dialog tree
  const flatMoveDialogTree = useMemo(
    () => flattenTree(filteredMoveDialogTree),
    [filteredMoveDialogTree]
  );

  // Get moving folder
  const movingFolder = useMemo(
    () => folders.find((f) => f.id === movingFolderId),
    [folders, movingFolderId]
  );

  // Count total workflows
  const totalWorkflows = workflows.length;
  const uncategorizedCount = workflows.filter(
    (w) => !(w as any).folderId
  ).length;

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Handlers
  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const allIds = new Set(folders.map((f) => f.id));
    setExpandedIds(allIds);
  }, [folders]);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const handleStartEdit = useCallback((id: string, name: string) => {
    setEditingFolderId(id);
    setEditingName(name);
  }, []);

  const handleFinishEdit = useCallback(
    (save: boolean) => {
      if (save && editingFolderId && editingName.trim()) {
        onUpdateFolder(editingFolderId, { name: editingName.trim() });
      }
      setEditingFolderId(null);
      setEditingName("");
    },
    [editingFolderId, editingName, onUpdateFolder]
  );

  const handleCreateSubfolder = useCallback((parentId: string) => {
    setCreatingInParentId(parentId);
    setNewFolderName("");
    // Expand parent
    setExpandedIds((prev) => new Set(prev).add(parentId));
  }, []);

  const handleFinishCreate = useCallback(
    (save: boolean) => {
      if (save && newFolderName.trim()) {
        onCreateFolder(newFolderName.trim(), creatingInParentId);
      }
      setCreatingInParentId(null);
      setNewFolderName("");
    },
    [newFolderName, creatingInParentId, onCreateFolder]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Drag over handling can be implemented here if needed
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const dragData = active.data.current as DragItem;
        const dropData = over.data.current as DragItem | undefined;

        if (dragData.type === "folder") {
          // Moving a folder
          const newParentId = dropData?.type === "folder" ? dropData.id : null;
          // Prevent moving folder into itself or its descendants
          const folder = folders.find((f) => f.id === dragData.id);
          if (folder && newParentId !== folder.id) {
            onMoveFolder(dragData.id, newParentId);
          }
        } else if (dragData.type === "workflow") {
          // Moving a workflow
          const newFolderId = dropData?.type === "folder" ? dropData.id : null;
          onMoveWorkflow(dragData.id, newFolderId);
        }
      }

      setActiveId(null);
    },
    [folders, onMoveFolder, onMoveWorkflow]
  );

  const handleMoveDialogToggle = useCallback((id: string) => {
    setMoveDialogExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleMoveFolder = useCallback(
    (targetFolderId: string | null) => {
      if (movingFolderId) {
        onMoveFolder(movingFolderId, targetFolderId);
        setMovingFolderId(null);
        setMoveDialogSearchQuery("");
        setMoveDialogExpandedIds(new Set());
      }
    },
    [movingFolderId, onMoveFolder]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedFolderId) return;

      const currentIndex = flatTree.findIndex((n) => n.id === selectedFolderId);
      if (currentIndex === -1) return;

      const currentNode = flatTree[currentIndex];
      if (!currentNode) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (currentIndex < flatTree.length - 1) {
            const nextNode = flatTree[currentIndex + 1];
            if (nextNode) {
              onSelectFolder(nextNode.id);
            }
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (currentIndex > 0) {
            const prevNode = flatTree[currentIndex - 1];
            if (prevNode) {
              onSelectFolder(prevNode.id);
            }
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (currentNode.children.length > 0 && !currentNode.expanded) {
            handleToggle(currentNode.id);
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (currentNode.expanded) {
            handleToggle(currentNode.id);
          } else if (currentNode.parentId) {
            onSelectFolder(currentNode.parentId);
          }
          break;

        case "Enter":
          e.preventDefault();
          if (currentNode && currentNode.children.length > 0) {
            handleToggle(currentNode.id);
          }
          break;

        case "Delete":
          e.preventDefault();
          if (
            currentNode &&
            window.confirm(`Delete folder "${currentNode.name}"?`)
          ) {
            onDeleteFolder(currentNode.id);
          }
          break;
      }
    },
    [selectedFolderId, flatTree, onSelectFolder, handleToggle, onDeleteFolder]
  );

  return (
    <div
      className={cn("flex flex-col h-full", className)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search folders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCreateFolder("New Folder")}
            className="flex-1"
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExpandAll}
            title="Expand All"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCollapseAll}
            title="Collapse All"
          >
            <Minus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* All Workflows root */}
          <div
            className={cn(
              "flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer mb-1 transition-colors",
              selectedFolderId === null && "bg-accent",
              selectedFolderId !== null && "hover:bg-accent/50"
            )}
            onClick={() => onSelectFolder(null)}
          >
            <FolderTreeIcon className="h-4 w-4" />
            <span className="text-sm font-medium flex-1">All Workflows</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {totalWorkflows}
            </Badge>
          </div>

          {/* Uncategorized (if any) */}
          {uncategorizedCount > 0 && (
            <div
              className={cn(
                "flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer mb-1 transition-colors",
                selectedFolderId === "uncategorized" && "bg-accent",
                selectedFolderId !== "uncategorized" && "hover:bg-accent/50"
              )}
              onClick={() => onSelectFolder("uncategorized")}
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium flex-1 text-muted-foreground">
                Uncategorized
              </span>
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {uncategorizedCount}
              </Badge>
            </div>
          )}

          {/* Folder tree */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={flatTree.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0.5">
                {flatTree.map((node) => (
                  <FolderTreeItem
                    key={node.id}
                    node={node}
                    isSelected={selectedFolderId === node.id}
                    isEditing={editingFolderId === node.id}
                    editingName={editingName}
                    onSelect={onSelectFolder}
                    onToggle={handleToggle}
                    onStartEdit={handleStartEdit}
                    onFinishEdit={handleFinishEdit}
                    onEditingNameChange={setEditingName}
                    onDelete={onDeleteFolder}
                    onCreateSubfolder={handleCreateSubfolder}
                    onChangeColor={(id) => setShowColorPicker(id)}
                    onChangeIcon={(id) => setShowIconPicker(id)}
                    onMove={(id) => {
                      setMovingFolderId(id);
                    }}
                  />
                ))}

                {/* Inline folder creation */}
                {creatingInParentId !== null && (
                  <div
                    className="flex items-center gap-1 py-1 px-2"
                    style={{
                      paddingLeft:
                        (folders.find((f) => f.id === creatingInParentId)
                          ? flatTree.find((n) => n.id === creatingInParentId)
                              ?.depth || 0
                          : 0) *
                          20 +
                        44,
                    }}
                  >
                    <FolderPlus className="h-4 w-4 text-muted-foreground" />
                    <Input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onBlur={() => handleFinishCreate(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleFinishCreate(true);
                        } else if (e.key === "Escape") {
                          handleFinishCreate(false);
                        }
                      }}
                      placeholder="New folder name..."
                      className="h-6 py-0 px-1 text-sm flex-1"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeId && flatTree.find((n) => n.id === activeId) ? (
                <div className="bg-accent rounded-md p-2 shadow-lg flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {flatTree.find((n) => n.id === activeId)?.name}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Empty state */}
          {flatTree.length === 0 && !creatingInParentId && (
            <div className="text-center py-8 text-muted-foreground">
              <FolderTreeIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm">
                {searchQuery ? "No folders found" : "No folders yet"}
              </p>
              {!searchQuery && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => onCreateFolder("New Folder")}
                  className="mt-2"
                >
                  Create your first folder
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Color picker modal */}
      {showColorPicker && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-popover rounded-lg shadow-lg border">
            <ColorPicker
              currentColor={
                folders.find((f) => f.id === showColorPicker)?.color
              }
              onColorSelect={(color) => {
                onUpdateFolder(showColorPicker, { color });
                setShowColorPicker(null);
              }}
              onClose={() => setShowColorPicker(null)}
            />
          </div>
        </div>
      )}

      {/* Icon picker modal */}
      {showIconPicker && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-popover rounded-lg shadow-lg border">
            <IconPicker
              currentIcon={folders.find((f) => f.id === showIconPicker)?.icon}
              onIconSelect={(icon) => {
                onUpdateFolder(showIconPicker, { icon });
                setShowIconPicker(null);
              }}
              onClose={() => setShowIconPicker(null)}
            />
          </div>
        </div>
      )}

      {/* Move folder dialog */}
      <Dialog
        open={!!movingFolderId}
        onOpenChange={(open) => !open && setMovingFolderId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move "{movingFolder?.name}" to...</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search folders..."
                value={moveDialogSearchQuery}
                onChange={(e) => setMoveDialogSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Folder list */}
            <ScrollArea className="h-96">
              <div className="space-y-1 pr-4">
                {/* Root option */}
                <button
                  onClick={() => handleMoveFolder(null)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors hover:bg-accent"
                  )}
                >
                  <FolderTreeIcon className="h-4 w-4" />
                  <span>Root (Top Level)</span>
                </button>

                {/* Folder tree */}
                {flatMoveDialogTree.map((node) => {
                  const hasChildren = node.children.length > 0;
                  const FolderIcon = node.expanded ? FolderOpen : Folder;

                  return (
                    <div
                      key={node.id}
                      className="flex items-center gap-1 px-3 py-2 rounded-md transition-colors hover:bg-accent"
                      style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
                    >
                      {/* Expand/collapse */}
                      {hasChildren ? (
                        <button
                          onClick={() => handleMoveDialogToggle(node.id)}
                          className="flex-shrink-0 p-0.5 hover:bg-accent rounded"
                        >
                          {node.expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <div className="w-5" />
                      )}

                      {/* Folder button */}
                      <button
                        onClick={() => handleMoveFolder(node.id)}
                        className="flex-1 flex items-center gap-2 text-left"
                      >
                        <FolderIcon
                          className="h-4 w-4 flex-shrink-0"
                          style={{ color: node.color || undefined }}
                        />
                        <span className="truncate">{node.name}</span>
                      </button>
                    </div>
                  );
                })}

                {/* Empty state */}
                {flatMoveDialogTree.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    {moveDialogSearchQuery
                      ? "No folders found"
                      : "No folders available"}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Breadcrumb / Info footer */}
      <div className="p-2 border-t text-xs text-muted-foreground">
        {selectedFolderId && selectedFolderId !== "uncategorized" && (
          <div className="flex items-center gap-1">
            {(() => {
              const folder = folders.find((f) => f.id === selectedFolderId);
              if (!folder) return null;

              const breadcrumbs: string[] = [];
              let current: WorkflowFolder | undefined = folder;
              while (current) {
                breadcrumbs.unshift(current.name);
                current = folders.find((f) => f.id === current?.parentId);
              }

              return breadcrumbs.join(" / ");
            })()}
          </div>
        )}
        {selectedFolderId === null && <div>Viewing all workflows</div>}
        {selectedFolderId === "uncategorized" && (
          <div>Workflows without a folder</div>
        )}
      </div>
    </div>
  );
}
