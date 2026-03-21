import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AccessibilityNode } from "../_types";
import {
  getRoleIcon,
  getRoleBadgeVariant,
  hasMatchingDescendant,
} from "../_utils";

export function AccessibilityTreeNode({
  node,
  depth = 0,
  searchQuery,
  selectedRef,
  onSelectNode,
}: {
  node: AccessibilityNode;
  depth?: number;
  searchQuery: string;
  selectedRef: string | null;
  onSelectNode: (node: AccessibilityNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const matchesSearch =
    !searchQuery.trim() ||
    node.role?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.value?.toLowerCase().includes(searchQuery.toLowerCase());

  const childrenMatch =
    searchQuery.trim() &&
    node.children?.some(
      (child) =>
        child.role?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        child.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hasMatchingDescendant(child, searchQuery)
    );

  if (searchQuery.trim() && !matchesSearch && !childrenMatch) {
    return null;
  }

  const isSelected = Boolean(node.ref && node.ref === selectedRef);

  return (
    <div
      className={depth > 0 ? "ml-4 border-l border-border-subtle/30 pl-2" : ""}
    >
      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors cursor-pointer ${
          isSelected
            ? "bg-brand-primary/20 ring-1 ring-brand-primary/40"
            : matchesSearch && searchQuery.trim()
              ? "bg-brand-primary/10"
              : "hover:bg-surface-hover"
        }`}
        onClick={() => onSelectNode(node)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectNode(node);
          }
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-text-muted hover:text-white"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        {getRoleIcon(node.role)}

        <Badge
          variant={getRoleBadgeVariant(node.role)}
          className="text-[10px] px-1.5 py-0"
        >
          {node.role}
        </Badge>

        {node.name && (
          <span className="text-sm text-text-primary truncate">
            {node.name}
          </span>
        )}

        {node.value && (
          <span className="text-xs text-text-muted italic truncate">
            = &quot;{node.value}&quot;
          </span>
        )}

        {node.is_interactive && (
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child, idx) => (
            <AccessibilityTreeNode
              key={`${child.role}-${child.name ?? ""}-${idx}`}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              selectedRef={selectedRef}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
