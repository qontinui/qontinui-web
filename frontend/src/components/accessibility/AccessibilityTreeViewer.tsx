"use client";

import * as React from "react";
import { useState, useCallback, useMemo } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import {
  RefreshCw,
  Filter,
  Search,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { AccessibilityNodeItem } from "./AccessibilityNodeItem";
import type {
  AccessibilityNode,
  AccessibilitySnapshot,
  AccessibilityRole,
} from "@qontinui/shared-types/accessibility";

interface AccessibilityTreeViewerProps {
  snapshot: AccessibilitySnapshot | null;
  selectedRef: string | null;
  onSelectNode: (node: AccessibilityNode) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  className?: string;
}

export function AccessibilityTreeViewer({
  snapshot,
  selectedRef,
  onSelectNode,
  onRefresh,
  isLoading = false,
  className,
}: AccessibilityTreeViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [interactiveOnly, setInteractiveOnly] = useState(true);
  const {
    expanded: expandedRefs,
    toggle: handleToggleExpand,
    expandAll,
    collapseAll: handleCollapseAll,
  } = useExpandableSet();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<AccessibilityRole | null>(null);

  // Expand all nodes
  const handleExpandAll = useCallback(() => {
    if (!snapshot?.root) return;

    const allRefs: string[] = [];
    const collectRefs = (node: AccessibilityNode) => {
      if (node.children && node.children.length > 0) {
        allRefs.push(node.ref);
        node.children.forEach(collectRefs);
      }
    };
    collectRefs(snapshot.root);
    expandAll(allRefs);
  }, [snapshot?.root, expandAll]);

  // Copy ref to clipboard
  const handleCopyRef = useCallback((ref: string) => {
    void navigator.clipboard.writeText(ref);
    toast.success(`Copied ${ref} to clipboard`);
  }, []);

  // Filter nodes based on search and filters
  const filteredRoot = useMemo(() => {
    if (!snapshot?.root) return null;

    const filterNode = (node: AccessibilityNode): AccessibilityNode | null => {
      // Check if this node matches filters
      const matchesSearch =
        !searchQuery ||
        node.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.ref.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.value?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesRole = !roleFilter || node.role === roleFilter;
      const matchesInteractive = !interactiveOnly || node.is_interactive;

      // Filter children recursively
      const filteredChildren =
        node.children
          ?.map(filterNode)
          .filter((child): child is AccessibilityNode => child !== null) ?? [];

      // Include node if it matches or has matching descendants
      if (
        (matchesSearch && matchesRole && matchesInteractive) ||
        filteredChildren.length > 0
      ) {
        return {
          ...node,
          children: filteredChildren,
        };
      }

      return null;
    };

    return filterNode(snapshot.root);
  }, [snapshot?.root, searchQuery, roleFilter, interactiveOnly]);

  // Get unique roles from the tree for filtering
  const availableRoles = useMemo(() => {
    if (!snapshot?.root) return [];

    const roles = new Set<AccessibilityRole>();
    const collectRoles = (node: AccessibilityNode) => {
      roles.add(node.role);
      node.children?.forEach(collectRoles);
    };
    collectRoles(snapshot.root);
    return Array.from(roles).sort();
  }, [snapshot?.root]);

  return (
    <div
      className={cn("flex flex-col h-full", className)}
      data-slot="accessibility-tree-viewer"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Accessibility Tree</h3>
          {snapshot && (
            <span className="text-xs text-muted-foreground">
              {snapshot.total_nodes ?? 0} nodes (
              {snapshot.interactive_nodes ?? 0} interactive)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExpandAll}
            disabled={!snapshot}
            title="Expand all"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCollapseAll}
            disabled={!snapshot}
            title="Collapse all"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh tree"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, ref, or value..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </span>
              {filtersOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="interactive-only" className="text-sm">
                Interactive only
              </Label>
              <Switch
                id="interactive-only"
                checked={interactiveOnly}
                onCheckedChange={setInteractiveOnly}
              />
            </div>

            {availableRoles.length > 0 && (
              <div className="space-y-1">
                <Label className="text-sm">Filter by role</Label>
                <select
                  value={roleFilter ?? ""}
                  onChange={(e) =>
                    setRoleFilter(
                      e.target.value
                        ? (e.target.value as AccessibilityRole)
                        : null
                    )
                  }
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">All roles</option>
                  {availableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Tree content */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Capturing accessibility tree...
            </div>
          ) : !snapshot ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">No accessibility tree captured</span>
              <Button variant="outline" size="sm" onClick={onRefresh}>
                Capture Tree
              </Button>
            </div>
          ) : !filteredRoot ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <Search className="h-5 w-5" />
              <span className="text-sm">No nodes match your filters</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setRoleFilter(null);
                  setInteractiveOnly(false);
                }}
              >
                Clear Filters
              </Button>
            </div>
          ) : (
            <AccessibilityNodeItem
              node={filteredRoot}
              depth={0}
              selectedRef={selectedRef}
              onSelectNode={onSelectNode}
              onCopyRef={handleCopyRef}
              expandedRefs={expandedRefs}
              onToggleExpand={handleToggleExpand}
              interactiveOnly={interactiveOnly}
            />
          )}
        </div>
      </ScrollArea>

      {/* Page info footer */}
      {snapshot && (
        <div className="p-2 border-t text-xs text-muted-foreground">
          {snapshot.title && <div className="truncate">{snapshot.title}</div>}
          {snapshot.url && (
            <div className="truncate text-[10px] opacity-75">
              {snapshot.url}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
