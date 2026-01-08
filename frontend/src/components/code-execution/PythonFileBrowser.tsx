/**
 * Python File Browser Component
 *
 * Allows users to browse and select Python (.py) files from their project directory.
 * Displays files in a tree view with search/filter capabilities.
 *
 * Features:
 * - Tree view of Python files
 * - Search/filter by filename
 * - File metadata (size, last modified)
 * - Path validation
 * - Loading states
 * - Error handling
 * - Accessible keyboard navigation
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  Search,
  FileCode,
  AlertCircle,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface PythonFile {
  path: string; // Relative path from project root
  name: string;
  size: number;
  lastModified: string;
  isValid: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
  file?: PythonFile;
}

export interface PythonFileBrowserProps {
  /** Currently selected file path */
  selectedPath?: string;
  /** Callback when file is selected */
  onSelectFile: (path: string) => void;
  /** Optional: List of files (if not using hook) */
  files?: PythonFile[];
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: string | null;
  /** Refresh callback */
  onRefresh?: () => void;
  /** Optional: Validate file on selection */
  validateOnSelect?: boolean;
  /** Optional: Custom height */
  height?: string;
  /** Optional: Show file metadata */
  showMetadata?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build tree structure from flat file list
 */
function buildFileTree(files: PythonFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  files.forEach((file) => {
    const pathParts = file.path.split("/");
    let currentLevel = root;
    let currentPath = "";

    // Process directories
    for (let i = 0; i < pathParts.length - 1; i++) {
      const dirName = pathParts[i];
      if (!dirName) continue;
      currentPath = currentPath ? `${currentPath}/${dirName}` : dirName;

      let dirNode = dirMap.get(currentPath);
      if (!dirNode) {
        dirNode = {
          name: dirName,
          path: currentPath,
          type: "directory",
          children: [],
        };
        dirMap.set(currentPath, dirNode);
        currentLevel.push(dirNode);
      }
      if (dirNode?.children) {
        currentLevel = dirNode.children;
      }
    }

    // Add file
    const fileName = pathParts[pathParts.length - 1];
    if (fileName) {
      currentLevel.push({
        name: fileName,
        path: file.path,
        type: "file",
        file,
      });
    }
  });

  return root;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

// ============================================================================
// Tree Node Component
// ============================================================================

interface TreeNodeProps {
  node: FileTreeNode;
  selectedPath?: string;
  onSelectFile: (path: string) => void;
  showMetadata: boolean;
  depth: number;
}

function TreeNode({
  node,
  selectedPath,
  onSelectFile,
  showMetadata,
  depth,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth === 0);
  const isSelected = selectedPath === node.path;

  const handleClick = useCallback(() => {
    if (node.type === "file") {
      onSelectFile(node.path);
    } else {
      setIsExpanded(!isExpanded);
    }
  }, [node, isExpanded, onSelectFile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      } else if (
        e.key === "ArrowRight" &&
        node.type === "directory" &&
        !isExpanded
      ) {
        e.preventDefault();
        setIsExpanded(true);
      } else if (
        e.key === "ArrowLeft" &&
        node.type === "directory" &&
        isExpanded
      ) {
        e.preventDefault();
        setIsExpanded(false);
      }
    },
    [handleClick, node.type, isExpanded]
  );

  const paddingLeft = depth * 16 + 8;

  if (node.type === "directory") {
    return (
      <div>
        <div
          className={cn(
            "flex items-center gap-2 py-1.5 px-2 cursor-pointer rounded transition-colors",
            "hover:bg-surface-raised dark:hover:bg-surface-raised",
            "focus:outline-none focus:ring-2 focus:ring-blue-500"
          )}
          style={{ paddingLeft }}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="button"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
          )}
          <span className="text-sm font-medium text-text-secondary dark:text-text-secondary">
            {node.name}
          </span>
          {node.children && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {node.children.length}
            </Badge>
          )}
        </div>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                showMetadata={showMetadata}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 cursor-pointer rounded transition-colors",
        "hover:bg-surface-raised dark:hover:bg-surface-raised",
        "focus:outline-none focus:ring-2 focus:ring-blue-500",
        isSelected &&
          "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700"
      )}
      style={{ paddingLeft }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-selected={isSelected}
    >
      <FileCode className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary dark:text-text-primary truncate">
            {node.name}
          </span>
          {node.file?.isValid === false && (
            <AlertCircle
              className="w-3 h-3 text-red-500 flex-shrink-0"
              aria-label="File validation failed"
            />
          )}
          {isSelected && (
            <CheckCircle className="w-3 h-3 text-blue-500 flex-shrink-0" />
          )}
        </div>
        {showMetadata && node.file && (
          <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
            <span>{formatFileSize(node.file.size)}</span>
            <span>{formatDate(node.file.lastModified)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PythonFileBrowser({
  selectedPath,
  onSelectFile,
  files = [],
  isLoading = false,
  error = null,
  onRefresh,
  height = "400px",
  showMetadata = true,
}: PythonFileBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter files by search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const query = searchQuery.toLowerCase();
    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(query) ||
        file.path.toLowerCase().includes(query)
    );
  }, [files, searchQuery]);

  // Build tree from filtered files
  const fileTree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);

  return (
    <div className="space-y-3">
      {/* Search and Refresh */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            type="text"
            placeholder="Search Python files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label="Search files"
          />
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh file list"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
        )}
      </div>

      {/* File Count */}
      {!error && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}{" "}
            found
            {searchQuery && ` (filtered from ${files.length})`}
          </span>
          {selectedPath && (
            <span className="text-blue-600 dark:text-blue-400">
              Selected: {selectedPath}
            </span>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900 dark:text-red-100">
              Error loading files
            </p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-1">
              {error}
            </p>
          </div>
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">Loading files...</span>
        </div>
      )}

      {/* File Tree */}
      {!isLoading && !error && (
        <ScrollArea style={{ height }} className="border rounded">
          <div className="p-2">
            {fileTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileCode className="w-12 h-12 text-text-secondary dark:text-text-muted mb-3" />
                <p className="text-sm font-medium text-text-secondary dark:text-text-secondary">
                  {searchQuery
                    ? "No files match your search"
                    : "No Python files found"}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {searchQuery
                    ? "Try a different search term"
                    : "Add .py files to your project directory"}
                </p>
              </div>
            ) : (
              <div role="tree" aria-label="Python files">
                {fileTree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    selectedPath={selectedPath}
                    onSelectFile={onSelectFile}
                    showMetadata={showMetadata}
                    depth={0}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Help Text */}
      {!error && !isLoading && files.length > 0 && (
        <p className="text-xs text-text-muted">
          Select a Python file to use in your code execution action. Files are
          relative to your project root.
        </p>
      )}
    </div>
  );
}
