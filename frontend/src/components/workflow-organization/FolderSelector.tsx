/**
 * Folder Selector Component
 *
 * Dropdown/Dialog for selecting a folder from the tree
 */

import React, { useState, useMemo } from "react";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Home,
  Search,
} from "lucide-react";
import { WorkflowFolder, FolderTreeNode } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { cn } from "../../lib/utils";

export interface FolderSelectorProps {
  folders: WorkflowFolder[];
  selectedFolderId?: string | null;
  onSelect: (folderId: string | null) => void;
  excludeFolderIds?: string[]; // Folders to exclude (e.g., when moving, exclude the folder being moved)
  allowRoot?: boolean; // Allow selecting root (null)
  allowUncategorized?: boolean; // Show uncategorized option
  placeholder?: string;
  className?: string;
}

/**
 * Build tree structure for selector
 */
function buildTree(
  folders: WorkflowFolder[],
  expandedIds: Set<string>,
  excludeIds: string[] = []
): FolderTreeNode[] {
  const folderMap = new Map<string, FolderTreeNode>();
  const rootFolders: FolderTreeNode[] = [];

  // Create nodes
  folders
    .filter((f) => !excludeIds.includes(f.id))
    .forEach((folder) => {
      const node: FolderTreeNode = {
        ...folder,
        children: [],
        workflowCount: 0,
        totalWorkflowCount: 0,
        depth: 0,
        expanded: expandedIds.has(folder.id),
      };
      folderMap.set(folder.id, node);
    });

  // Build hierarchy
  folders
    .filter((f) => !excludeIds.includes(f.id))
    .forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parentId === null || !folderMap.has(folder.parentId)) {
        rootFolders.push(node);
      } else {
        const parent = folderMap.get(folder.parentId)!;
        parent.children.push(node);
        node.depth = parent.depth + 1;
      }
    });

  return rootFolders;
}

/**
 * Flatten tree for rendering
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
 * Folder Selector - Dialog Version
 */
export function FolderSelector({
  folders,
  selectedFolderId,
  onSelect,
  excludeFolderIds = [],
  allowRoot = true,
  allowUncategorized = false,
  className,
}: FolderSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Build tree
  const tree = useMemo(
    () => buildTree(folders, expandedIds, excludeFolderIds),
    [folders, expandedIds, excludeFolderIds]
  );

  // Filter tree
  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree;

    const query = searchQuery.toLowerCase();
    function filterNode(node: FolderTreeNode): FolderTreeNode | null {
      const matches = node.name.toLowerCase().includes(query);
      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is FolderTreeNode => n !== null);

      if (matches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
          expanded: true, // Auto-expand when searching
        };
      }
      return null;
    }

    return tree.map(filterNode).filter((n): n is FolderTreeNode => n !== null);
  }, [tree, searchQuery]);

  const flatTree = useMemo(() => flattenTree(filteredTree), [filteredTree]);

  // Get selected folder name
  const selectedName = useMemo(() => {
    if (selectedFolderId === null) return "All Workflows";
    if (selectedFolderId === "uncategorized") return "Uncategorized";
    const folder = folders.find((f) => f.id === selectedFolderId);
    return folder?.name || "Unknown";
  }, [selectedFolderId, folders]);

  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelect = (id: string | null) => {
    onSelect(id);
    setOpen(false);
    setSearchQuery("");
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn("justify-start", className)}
      >
        <Folder className="h-4 w-4 mr-2" />
        <span className="truncate">{selectedName}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select Folder</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
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

            {/* Folder list */}
            <ScrollArea className="h-96">
              <div className="space-y-1 pr-4">
                {/* Root option */}
                {allowRoot && (
                  <button
                    onClick={() => handleSelect(null)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
                      selectedFolderId === null
                        ? "bg-accent font-medium"
                        : "hover:bg-accent"
                    )}
                  >
                    <Home className="h-4 w-4" />
                    <span>All Workflows</span>
                  </button>
                )}

                {/* Uncategorized option */}
                {allowUncategorized && (
                  <button
                    onClick={() => handleSelect("uncategorized")}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
                      selectedFolderId === "uncategorized"
                        ? "bg-accent font-medium"
                        : "hover:bg-accent"
                    )}
                  >
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Uncategorized</span>
                  </button>
                )}

                {/* Folder tree */}
                {flatTree.map((node) => {
                  const hasChildren = node.children.length > 0;
                  const FolderIcon = node.expanded ? FolderOpen : Folder;

                  return (
                    <div
                      key={node.id}
                      className={cn(
                        "flex items-center gap-1 px-3 py-2 rounded-md transition-colors",
                        selectedFolderId === node.id
                          ? "bg-accent font-medium"
                          : "hover:bg-accent"
                      )}
                      style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
                    >
                      {/* Expand/collapse */}
                      {hasChildren ? (
                        <button
                          onClick={() => handleToggle(node.id)}
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
                        onClick={() => handleSelect(node.id)}
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
                {flatTree.length === 0 && !allowRoot && !allowUncategorized && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    {searchQuery ? "No folders found" : "No folders available"}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Inline Folder Selector (for forms)
 */
export interface InlineFolderSelectorProps extends FolderSelectorProps {
  label?: string;
  error?: string;
}

export function InlineFolderSelector({
  label,
  error,
  ...props
}: InlineFolderSelectorProps) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
      <FolderSelector {...props} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
