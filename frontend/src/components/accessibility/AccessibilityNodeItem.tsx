"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  MousePointerClick,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  AccessibilityNode,
  AccessibilityRole,
} from "@qontinui/shared-types/accessibility";

interface AccessibilityNodeItemProps {
  node: AccessibilityNode;
  depth?: number;
  selectedRef: string | null;
  onSelectNode: (node: AccessibilityNode) => void;
  onCopyRef: (ref: string) => void;
  expandedRefs: Set<string>;
  onToggleExpand: (ref: string) => void;
  interactiveOnly?: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  button: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  link: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  textbox:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  checkbox:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  radio:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  combobox: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  menu: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  menuitem:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  heading: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  img: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  navigation:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
};

function getRoleColor(role: AccessibilityRole): string {
  return (
    ROLE_COLORS[role] ??
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
  );
}

export function AccessibilityNodeItem({
  node,
  depth = 0,
  selectedRef,
  onSelectNode,
  onCopyRef,
  expandedRefs,
  onToggleExpand,
  interactiveOnly = false,
}: AccessibilityNodeItemProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedRefs.has(node.ref);
  const isSelected = selectedRef === node.ref;
  const isInteractive = node.isInteractive ?? false;

  // If interactiveOnly mode and node is not interactive, skip rendering but still render children
  if (interactiveOnly && !isInteractive && hasChildren) {
    return (
      <>
        {node.children?.map((child) => (
          <AccessibilityNodeItem
            key={child.ref}
            node={child}
            depth={depth}
            selectedRef={selectedRef}
            onSelectNode={onSelectNode}
            onCopyRef={onCopyRef}
            expandedRefs={expandedRefs}
            onToggleExpand={onToggleExpand}
            interactiveOnly={interactiveOnly}
          />
        ))}
      </>
    );
  }

  // Skip non-interactive nodes entirely in interactiveOnly mode
  if (interactiveOnly && !isInteractive) {
    return null;
  }

  return (
    <div data-slot="accessibility-node">
      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        className={cn(
          "flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-muted/50 transition-colors",
          isSelected && "bg-primary/10 border border-primary/30",
          isInteractive && "font-medium"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelectNode(node)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectNode(node);
          }
        }}
      >
        {/* Expand/Collapse button */}
        {hasChildren ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.ref);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        ) : (
          <span className="w-5" />
        )}

        {/* Ref badge */}
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-xs px-1.5 py-0 cursor-pointer hover:bg-primary/20",
            isInteractive && "border-primary/50"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onCopyRef(node.ref);
          }}
          title="Click to copy ref"
        >
          {node.ref}
        </Badge>

        {/* Role badge */}
        <Badge className={cn("text-xs px-1.5 py-0", getRoleColor(node.role))}>
          {node.role}
        </Badge>

        {/* Name */}
        {node.name && (
          <span className="text-sm truncate max-w-[200px]" title={node.name}>
            &quot;{node.name}&quot;
          </span>
        )}

        {/* Value */}
        {node.value && (
          <span
            className="text-xs text-muted-foreground truncate max-w-[100px]"
            title={node.value}
          >
            = {node.value}
          </span>
        )}

        {/* Interactive indicator */}
        {isInteractive && (
          <span title="Interactive element">
            <MousePointerClick className="h-3 w-3 text-primary ml-auto" />
          </span>
        )}

        {/* Copy button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 hover:opacity-100 ml-auto"
          onClick={(e) => {
            e.stopPropagation();
            onCopyRef(node.ref);
          }}
          title="Copy ref"
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div data-slot="accessibility-children">
          {node.children?.map((child) => (
            <AccessibilityNodeItem
              key={child.ref}
              node={child}
              depth={depth + 1}
              selectedRef={selectedRef}
              onSelectNode={onSelectNode}
              onCopyRef={onCopyRef}
              expandedRefs={expandedRefs}
              onToggleExpand={onToggleExpand}
              interactiveOnly={interactiveOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
