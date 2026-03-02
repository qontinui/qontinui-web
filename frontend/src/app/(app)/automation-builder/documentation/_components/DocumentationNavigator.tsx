"use client";

import React from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Plus,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DocumentationNode,
  DocumentationFilter,
} from "../documentation-utils";

export interface DocumentationNavigatorProps {
  tree: DocumentationNode[];
  selectedNodeId: string | null;
  onSelectNode: (node: DocumentationNode) => void;
  filter: DocumentationFilter;
  onFilterChange: (filter: DocumentationFilter) => void;
}

export function DocumentationNavigator({
  tree,
  selectedNodeId,
  onSelectNode,
  filter,
  onFilterChange,
}: DocumentationNavigatorProps) {
  const { expanded: expandedNodes, toggle: toggleNode } = useExpandableSet([
    "workflows",
  ]);

  const renderNode = (
    node: DocumentationNode,
    depth: number = 0
  ): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const Icon = node.icon;

    if (
      filter.status === "documented" &&
      !node.hasDocumentation &&
      node.type === "workflow"
    ) {
      return null;
    }
    if (
      filter.status === "undocumented" &&
      node.hasDocumentation &&
      node.type === "workflow"
    ) {
      return null;
    }
    if (filter.searchQuery && node.type === "workflow") {
      if (
        !node.label.toLowerCase().includes(filter.searchQuery.toLowerCase())
      ) {
        return null;
      }
    }

    return (
      <div key={node.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleNode(node.id);
            }
            onSelectNode(node);
          }}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
            isSelected && "bg-primary/20 text-primary font-medium",
            !isSelected && "hover:bg-muted text-muted-foreground"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren && (
            <span className="size-4 flex items-center justify-center">
              {isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </span>
          )}
          {!hasChildren && <span className="size-4" />}
          <Icon className="size-4 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{node.label}</span>
          {node.type === "workflow" && !node.hasDocumentation && (
            <AlertCircle className="size-3 text-yellow-500" />
          )}
          {node.type === "workflow" && node.hasDocumentation && (
            <CheckCircle2 className="size-3 text-green-500" />
          )}
        </button>

        {hasChildren && isExpanded && (
          <div>
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full border-r border-border bg-muted/50">
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          <h3 className="font-semibold">Documentation</h3>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search docs..."
            value={filter.searchQuery}
            onChange={(e) =>
              onFilterChange({ ...filter, searchQuery: e.target.value })
            }
            className="pl-8 h-9 bg-background border-border"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Select
            value={filter.status}
            onValueChange={(value) =>
              onFilterChange({
                ...filter,
                status: value as "all" | "documented" | "undocumented",
              })
            }
          >
            <SelectTrigger className="h-9 bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workflows</SelectItem>
              <SelectItem value="documented">Documented</SelectItem>
              <SelectItem value="undocumented">Undocumented</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {tree.map((node) => renderNode(node))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="w-full border-border hover:border-primary hover:text-primary bg-transparent"
          onClick={() => tree[0] && onSelectNode(tree[0])}
        >
          <Plus className="size-4 mr-2" />
          New Doc
        </Button>
      </div>
    </div>
  );
}
