"use client";

import { useState, useMemo } from "react";
import type { DiscoveredLink } from "@/hooks/use-inspector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  FileText,
  Network,
  Loader2,
} from "lucide-react";

interface SiteTreePanelProps {
  discoveredLinks: DiscoveredLink[];
  onNavigate?: (url: string) => void;
  isNavigating?: boolean;
}

/** Build a path-segment tree from flat link list */
interface TreeNode {
  segment: string;
  fullPath: string;
  links: DiscoveredLink[];
  children: Map<string, TreeNode>;
}

function buildTree(links: DiscoveredLink[]): TreeNode {
  const root: TreeNode = {
    segment: "/",
    fullPath: "/",
    links: [],
    children: new Map(),
  };

  for (const link of links) {
    const parts = link.url.split("/").filter((p) => p.length > 0);

    let current = root;
    let path = "";

    for (const part of parts) {
      path += "/" + part;
      if (!current.children.has(part)) {
        current.children.set(part, {
          segment: part,
          fullPath: path,
          links: [],
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }

    current.links.push(link);
  }

  return root;
}

function TreeNodeView({
  node,
  depth,
  onNavigate,
}: {
  node: TreeNode;
  depth: number;
  onNavigate?: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.size > 0;
  const link = node.links.length > 0 ? node.links[0]! : null;

  const handleClick = () => {
    if (link && onNavigate) {
      // Navigate to the page
      onNavigate(link.url);
      // If it also has children, expand them
      if (hasChildren && !expanded) setExpanded(true);
    } else if (hasChildren) {
      setExpanded(!expanded);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    // Chevron always toggles expand/collapse without navigating
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-left text-xs rounded transition-colors text-text-primary ${
          link && onNavigate
            ? "hover:bg-purple-500/10 cursor-pointer"
            : "hover:bg-surface-hover"
        }`}
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
        {link && (
          <span className="text-text-muted text-[10px] ml-auto flex-shrink-0 pl-2">
            {node.fullPath}
          </span>
        )}
      </button>
      {expanded &&
        Array.from(node.children.values()).map((child) => (
          <TreeNodeView
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}

export function SiteTreePanel({
  discoveredLinks,
  onNavigate,
  isNavigating,
}: SiteTreePanelProps) {
  const tree = useMemo(() => buildTree(discoveredLinks), [discoveredLinks]);

  if (discoveredLinks.length === 0) return null;

  return (
    <div className="sticky top-16">
      <Card className="bg-surface-raised/50 border-purple-500/20">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-xs text-purple-300 flex items-center gap-1.5">
            <Network className="w-3 h-3" />
            Page Tree ({discoveredLinks.length})
            {isNavigating && (
              <Loader2 className="w-3 h-3 animate-spin text-purple-400 ml-auto" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <div className="max-h-[calc(100vh-180px)] overflow-y-auto -mx-1">
            {Array.from(tree.children.values()).map((child) => (
              <TreeNodeView
                key={child.fullPath}
                node={child}
                depth={0}
                onNavigate={isNavigating ? undefined : onNavigate}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
