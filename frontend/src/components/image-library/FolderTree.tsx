/**
 * FolderTree Component
 *
 * Folder tree navigation sidebar with create, rename, and delete operations.
 * Includes both the sidebar wrapper and recursive tree node components.
 */

"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Trash2,
  Check,
  MoreVertical,
  Edit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ImageFolder, ImageFolderTreeNode } from "./types";

// ============================================================================
// FolderTreeSidebar
// ============================================================================

export interface FolderTreeSidebarProps {
  folders: ImageFolderTreeNode[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<ImageFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onToggleExpanded: (folderId: string) => void;
}

export function FolderTreeSidebar({
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleExpanded,
}: FolderTreeSidebarProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onCreateFolder(newFolderName, null);
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border-subtle">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewFolder(!showNewFolder)}
          className="w-full border-border-default"
        >
          <FolderPlus className="w-4 h-4 mr-2" />
          New Folder
        </Button>

        {showNewFolder && (
          <div className="mt-2 flex gap-1">
            <Input
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              className="text-sm bg-transparent border-border-default"
            />
            <Button
              size="sm"
              onClick={handleCreateFolder}
              className="bg-brand-success text-black"
            >
              <Check className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* All Images */}
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-1",
              selectedFolderId === null
                ? "bg-brand-success/20 text-brand-success"
                : "hover:bg-surface-raised"
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
            <ImageIcon className="w-4 h-4" />
            <span className="text-sm font-medium flex-1">All Images</span>
          </div>

          {/* Folder Tree */}
          {folders.map((folder) => (
            <FolderTreeNode
              key={folder.id}
              folder={folder}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onUpdateFolder={onUpdateFolder}
              onDeleteFolder={onDeleteFolder}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// FolderTreeNode (recursive)
// ============================================================================

interface FolderTreeNodeProps {
  folder: ImageFolderTreeNode;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onUpdateFolder: (id: string, updates: Partial<ImageFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onToggleExpanded: (folderId: string) => void;
}

function FolderTreeNode({
  folder,
  selectedFolderId,
  onSelectFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleExpanded,
}: FolderTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);

  const handleSaveEdit = () => {
    if (editName.trim() && editName !== folder.name) {
      onUpdateFolder(folder.id, { name: editName });
    }
    setIsEditing(false);
  };

  return (
    <div style={{ marginLeft: `${folder.depth * 12}px` }}>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors group",
          selectedFolderId === folder.id
            ? "bg-brand-success/20 text-brand-success"
            : "hover:bg-surface-raised"
        )}
      >
        {folder.children.length > 0 && (
          <button onClick={() => onToggleExpanded(folder.id)} className="p-0">
            {folder.expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        )}

        <div
          className="flex items-center gap-2 flex-1 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => !isEditing && onSelectFolder(folder.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!isEditing) onSelectFolder(folder.id);
            }
          }}
        >
          {folder.expanded ? (
            <FolderOpen className="w-4 h-4" style={{ color: folder.color }} />
          ) : (
            <Folder className="w-4 h-4" style={{ color: folder.color }} />
          )}

          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit();
                if (e.key === "Escape") {
                  setIsEditing(false);
                  setEditName(folder.name);
                }
              }}
              onBlur={handleSaveEdit}
              className="text-sm h-6 bg-transparent border-border-default"
            />
          ) : (
            <>
              <span className="text-sm font-medium flex-1">{folder.name}</span>
              <Badge
                variant="outline"
                className="text-xs border-border-default"
              >
                {folder.totalImageCount}
              </Badge>
            </>
          )}
        </div>

        {!isEditing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
              >
                <MoreVertical className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <DestructiveButton
                  onClick={() => onDeleteFolder(folder.id)}
                  className="w-full justify-start text-red-400"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DestructiveButton>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {folder.expanded &&
        folder.children.map((child) => (
          <FolderTreeNode
            key={child.id}
            folder={child}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onUpdateFolder={onUpdateFolder}
            onDeleteFolder={onDeleteFolder}
            onToggleExpanded={onToggleExpanded}
          />
        ))}
    </div>
  );
}
