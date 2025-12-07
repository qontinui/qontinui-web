/**
 * Folder Breadcrumb Component
 *
 * Display folder path as breadcrumb navigation
 */

import React from "react";
import { ChevronRight, Home, Folder } from "lucide-react";
import { WorkflowFolder } from "./types";
import { getFolderPath } from "./folder-utils";
import { cn } from "../../lib/utils";

export interface FolderBreadcrumbProps {
  folderId: string | null;
  folders: WorkflowFolder[];
  onNavigate?: (folderId: string | null) => void;
  maxItems?: number;
  className?: string;
}

/**
 * Folder Breadcrumb Component
 *
 * Shows the path to the current folder as clickable breadcrumbs
 */
export function FolderBreadcrumb({
  folderId,
  folders,
  onNavigate,
  maxItems = 5,
  className,
}: FolderBreadcrumbProps) {
  // Build breadcrumb items
  const items = React.useMemo(() => {
    if (folderId === null) {
      return [];
    }

    if (folderId === "uncategorized") {
      return [{ id: "uncategorized", name: "Uncategorized" }];
    }

    const result: Array<{ id: string; name: string }> = [];

    let currentId: string | null = null;
    let current = folders.find((f) => f.id === folderId);

    while (current) {
      result.unshift({ id: current.id, name: current.name });
      currentId = current.parentId;
      current = currentId ? folders.find((f) => f.id === currentId) : undefined;
    }

    return result;
  }, [folderId, folders]);

  // Truncate if too many items
  const displayItems = React.useMemo(() => {
    if (items.length <= maxItems) {
      return items;
    }

    // Show first item, ellipsis, and last few items
    return [
      items[0],
      { id: "...", name: "..." },
      ...items.slice(-(maxItems - 2)),
    ];
  }, [items, maxItems]);

  const handleClick = (itemId: string) => {
    if (itemId === "..." || !onNavigate) return;
    onNavigate(itemId === "root" ? null : itemId);
  };

  return (
    <nav
      aria-label="Folder breadcrumb"
      className={cn("flex items-center gap-1 text-sm", className)}
    >
      {/* Home / Root */}
      <button
        onClick={() => onNavigate?.(null)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors",
          folderId === null && "bg-accent font-medium"
        )}
        aria-label="All Workflows"
      >
        <Home className="h-3.5 w-3.5" />
        <span>All</span>
      </button>

      {/* Breadcrumb items */}
      {displayItems.length > 0 && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          {displayItems.map((item, index) => {
            if (!item) return null;
            const isLast = index === displayItems.length - 1;
            const isEllipsis = item.id === "...";

            return (
              <React.Fragment key={item.id}>
                {isEllipsis ? (
                  <span className="px-2 py-1 text-muted-foreground">...</span>
                ) : (
                  <button
                    onClick={() => handleClick(item.id)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded transition-colors",
                      isLast
                        ? "bg-accent font-medium"
                        : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    )}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {!isLast && <Folder className="h-3.5 w-3.5" />}
                    <span className={cn(isLast && "font-medium")}>
                      {item.name}
                    </span>
                  </button>
                )}
                {!isLast && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </React.Fragment>
            );
          })}
        </>
      )}
    </nav>
  );
}

/**
 * Compact Folder Breadcrumb (path string only)
 */
export interface CompactFolderBreadcrumbProps {
  folderId: string | null;
  folders: WorkflowFolder[];
  separator?: string;
  className?: string;
}

export function CompactFolderBreadcrumb({
  folderId,
  folders,
  separator = " / ",
  className,
}: CompactFolderBreadcrumbProps) {
  const path = React.useMemo(() => {
    if (folderId === null) return "All Workflows";
    if (folderId === "uncategorized") return "Uncategorized";

    const folderPath = getFolderPath(folderId, folders);
    return folderPath.length > 0 ? folderPath.join(separator) : "Unknown";
  }, [folderId, folders, separator]);

  return (
    <div className={cn("text-sm text-muted-foreground truncate", className)}>
      {path}
    </div>
  );
}
