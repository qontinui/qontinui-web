"use client";

import { useState, useMemo } from "react";
import type { DiscoveredLink, PageNodeStatus } from "@/lib/ui-bridge/types";
import type { TreeNode } from "./tree-builder";
import { buildTree } from "./tree-builder";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  FileText,
  Network,
  Loader2,
  CheckCircle2,
  Circle,
} from "lucide-react";

// =============================================================================
// Props
// =============================================================================

export interface PageTreePanelProps {
  discoveredLinks: DiscoveredLink[];
  onPageClick?: (url: string, link: DiscoveredLink) => void;
  isBusy?: boolean;
  pageStatus?: Map<string, PageNodeStatus>;
  showSpecStatus?: boolean;
  title?: string;
  maxHeight?: string;
  className?: string;
}

// =============================================================================
// TreeNodeView (recursive renderer)
// =============================================================================

function TreeNodeView({
  node,
  depth,
  onPageClick,
  showSpecStatus,
}: {
  node: TreeNode;
  depth: number;
  onPageClick?: (url: string, link: DiscoveredLink) => void;
  showSpecStatus?: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.size > 0;
  const link = node.links.length > 0 ? node.links[0]! : null;

  const handleClick = () => {
    if (link && onPageClick) {
      onPageClick(link.url, link);
      if (hasChildren && !expanded) setExpanded(true);
    } else if (hasChildren) {
      setExpanded(!expanded);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  // Spec status indicator for the node
  const statusIcon = useMemo(() => {
    if (!showSpecStatus || !link) return null;
    const status = node.status;
    if (!status) return null;
    if (status.isLoading) {
      return (
        <Loader2 className="w-2.5 h-2.5 animate-spin text-purple-400 flex-shrink-0" />
      );
    }
    if (status.hasSpecs) {
      return (
        <CheckCircle2 className="w-2.5 h-2.5 text-green-400 flex-shrink-0" />
      );
    }
    return <Circle className="w-2.5 h-2.5 text-zinc-500 flex-shrink-0" />;
  }, [showSpecStatus, link, node.status]);

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-left text-xs rounded transition-colors text-text-primary ${
          link && onPageClick
            ? "hover:bg-purple-500/10 cursor-pointer"
            : "hover:bg-surface-hover"
        } ${node.status?.isActive ? "bg-purple-500/15 ring-1 ring-purple-500/30" : ""}`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {hasChildren ? (
          <span onClick={handleChevronClick} className="flex-shrink-0">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-text-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-muted" />
            )}
          </span>
        ) : (
          <FileText className="w-2.5 h-2.5 text-text-muted flex-shrink-0" />
        )}
        {hasChildren && (
          <FolderOpen className="w-2.5 h-2.5 text-amber-400/70 flex-shrink-0" />
        )}
        <span className="truncate">{link ? link.text : node.segment}</span>
        {statusIcon}
        {link && !showSpecStatus && (
          <span className="text-text-muted text-[10px] ml-auto flex-shrink-0 pl-2">
            {node.fullPath}
          </span>
        )}
        {link && showSpecStatus && node.status?.hasSpecs && (
          <span className="text-text-muted text-[10px] ml-auto flex-shrink-0 pl-2">
            {node.status.specGroupCount} group
            {node.status.specGroupCount !== 1 ? "s" : ""}
          </span>
        )}
      </button>
      {expanded &&
        Array.from(node.children.values()).map((child) => (
          <TreeNodeView
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            onPageClick={onPageClick}
            showSpecStatus={showSpecStatus}
          />
        ))}
    </div>
  );
}

// =============================================================================
// PageTreePanel
// =============================================================================

export function PageTreePanel({
  discoveredLinks,
  onPageClick,
  isBusy,
  pageStatus,
  showSpecStatus,
  title,
  maxHeight = "calc(100vh - 180px)",
  className,
}: PageTreePanelProps) {
  const tree = useMemo(
    () => buildTree(discoveredLinks, pageStatus),
    [discoveredLinks, pageStatus]
  );

  if (discoveredLinks.length === 0) return null;

  return (
    <Card
      className={`bg-surface-raised/50 border-purple-500/20 ${className ?? ""}`}
    >
      <CardHeader className="pb-1 pt-2 px-3">
        <CardTitle className="text-xs text-purple-300 flex items-center gap-1.5">
          <Network className="w-3 h-3" />
          {title ?? `Page Tree (${discoveredLinks.length})`}
          {isBusy && (
            <Loader2 className="w-3 h-3 animate-spin text-purple-400 ml-auto" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-2">
        <div className="overflow-y-auto -mx-1" style={{ maxHeight }}>
          {Array.from(tree.children.values()).map((child) => (
            <TreeNodeView
              key={child.fullPath}
              node={child}
              depth={0}
              onPageClick={isBusy ? undefined : onPageClick}
              showSpecStatus={showSpecStatus}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
