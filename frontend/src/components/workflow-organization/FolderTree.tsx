/**
 * Folder Tree Component
 *
 * Hierarchical tree view for organizing workflows in folders.
 * Features drag-and-drop, context menus, keyboard navigation, and inline editing.
 *
 * Thin orchestrator that composes sub-components and hooks.
 */

import React from "react";
import {
  Folder,
  FolderPlus,
  Search,
  Plus,
  Minus,
  FolderTreeIcon,
} from "lucide-react";
import { WorkflowFolder } from "./types";
import { Workflow } from "../../lib/action-schema/action-types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "../../lib/utils";

import { FolderTreeItem } from "./FolderTreeItem";
import { ColorPicker } from "./_components/ColorPicker";
import { IconPicker } from "./_components/IconPicker";
import { MoveFolderDialog } from "./_components/MoveFolderDialog";
import { FolderTreeFooter } from "./_components/FolderTreeFooter";
import { InlineFolderCreate } from "./_components/InlineFolderCreate";
import { useFolderTreeState } from "./_hooks/useFolderTreeState";
import { useFolderTreeHandlers } from "./_hooks/useFolderTreeHandlers";
import { useDropZone } from "@qontinui/ui-bridge";

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
  const state = useFolderTreeState(folders, workflows);
  useDropZone("folder-tree", { accepts: ["folder"], effect: "move" });

  const handlers = useFolderTreeHandlers({
    folders,
    onSelectFolder,
    onCreateFolder,
    onUpdateFolder,
    onDeleteFolder,
    onMoveFolder,
    onMoveWorkflow,
    selectedFolderId: selectedFolderId ?? null,
    setExpandedIds: state.setExpandedIds,
    editingFolderId: state.editingFolderId,
    setEditingFolderId: state.setEditingFolderId,
    editingName: state.editingName,
    setEditingName: state.setEditingName,
    creatingInParentId: state.creatingInParentId,
    setCreatingInParentId: state.setCreatingInParentId,
    newFolderName: state.newFolderName,
    setNewFolderName: state.setNewFolderName,
    setActiveId: state.setActiveId,
    flatTree: state.flatTree,
  });

  return (
    <div
      role="button"
      className={cn("flex flex-col h-full", className)}
      onKeyDown={handlers.handleKeyDown}
      tabIndex={0}
    >
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search folders..."
            value={state.searchQuery}
            onChange={(e) => state.setSearchQuery(e.target.value)}
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
            onClick={handlers.handleExpandAll}
            title="Expand All"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlers.handleCollapseAll}
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
            role="button"
            tabIndex={0}
            onClick={() => onSelectFolder(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectFolder(null);
              }
            }}
          >
            <FolderTreeIcon className="h-4 w-4" />
            <span className="text-sm font-medium flex-1">All Workflows</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {state.totalWorkflows}
            </Badge>
          </div>

          {/* Uncategorized (if any) */}
          {state.uncategorizedCount > 0 && (
            <div
              className={cn(
                "flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer mb-1 transition-colors",
                selectedFolderId === "uncategorized" && "bg-accent",
                selectedFolderId !== "uncategorized" && "hover:bg-accent/50"
              )}
              role="button"
              tabIndex={0}
              onClick={() => onSelectFolder("uncategorized")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectFolder("uncategorized");
                }
              }}
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium flex-1 text-muted-foreground">
                Uncategorized
              </span>
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {state.uncategorizedCount}
              </Badge>
            </div>
          )}

          {/* Folder tree */}
          <DndContext
            sensors={state.sensors}
            collisionDetection={closestCenter}
            onDragStart={handlers.handleDragStart}
            onDragOver={handlers.handleDragOver}
            onDragEnd={handlers.handleDragEnd}
          >
            <SortableContext
              items={state.flatTree.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0.5">
                {state.flatTree.map((node) => (
                  <FolderTreeItem
                    key={node.id}
                    node={node}
                    isSelected={selectedFolderId === node.id}
                    isEditing={state.editingFolderId === node.id}
                    editingName={state.editingName}
                    onSelect={onSelectFolder}
                    onToggle={handlers.handleToggle}
                    onStartEdit={handlers.handleStartEdit}
                    onFinishEdit={handlers.handleFinishEdit}
                    onEditingNameChange={state.setEditingName}
                    onDelete={onDeleteFolder}
                    onCreateSubfolder={handlers.handleCreateSubfolder}
                    onChangeColor={(id) => state.setShowColorPicker(id)}
                    onChangeIcon={(id) => state.setShowIconPicker(id)}
                    onMove={(id) => state.setMovingFolderId(id)}
                  />
                ))}

                {/* Inline folder creation */}
                <InlineFolderCreate
                  creatingInParentId={state.creatingInParentId}
                  newFolderName={state.newFolderName}
                  setNewFolderName={state.setNewFolderName}
                  onFinishCreate={handlers.handleFinishCreate}
                  flatTree={state.flatTree}
                />
              </div>
            </SortableContext>

            <DragOverlay>
              {state.activeId &&
              state.flatTree.find((n) => n.id === state.activeId) ? (
                <div className="bg-accent rounded-md p-2 shadow-lg flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {state.flatTree.find((n) => n.id === state.activeId)?.name}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Empty state */}
          {state.flatTree.length === 0 && !state.creatingInParentId && (
            <div className="text-center py-8 text-muted-foreground">
              <FolderTreeIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm">
                {state.searchQuery ? "No folders found" : "No folders yet"}
              </p>
              {!state.searchQuery && (
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
      {state.showColorPicker && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-popover rounded-lg shadow-lg border">
            <ColorPicker
              currentColor={
                folders.find((f) => f.id === state.showColorPicker)?.color
              }
              onColorSelect={(color) => {
                onUpdateFolder(state.showColorPicker!, { color });
                state.setShowColorPicker(null);
              }}
              onClose={() => state.setShowColorPicker(null)}
            />
          </div>
        </div>
      )}

      {/* Icon picker modal */}
      {state.showIconPicker && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-popover rounded-lg shadow-lg border">
            <IconPicker
              currentIcon={
                folders.find((f) => f.id === state.showIconPicker)?.icon
              }
              onIconSelect={(icon) => {
                onUpdateFolder(state.showIconPicker!, { icon });
                state.setShowIconPicker(null);
              }}
              onClose={() => state.setShowIconPicker(null)}
            />
          </div>
        </div>
      )}

      {/* Move folder dialog */}
      <MoveFolderDialog
        movingFolderId={state.movingFolderId}
        onClose={() => state.setMovingFolderId(null)}
        folders={folders}
        workflows={workflows}
        onMoveFolder={onMoveFolder}
      />

      {/* Breadcrumb / Info footer */}
      <FolderTreeFooter
        selectedFolderId={selectedFolderId ?? null}
        folders={folders}
      />
    </div>
  );
}
