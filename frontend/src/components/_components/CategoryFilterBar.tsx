"use client";

import { Badge } from "@/components/ui/badge";
import type { Context } from "@qontinui/shared-types/config";
import {
  getCategoryColor,
  CONTEXT_CATEGORIES,
  countAutoIncludeRules,
} from "../context-utils";

export interface CategoryFilterBarProps {
  contexts: Context[];
  categoryFilter: string;
  setCategoryFilter: (filter: string) => void;
  /** Render only the stats badges (Total Contexts, With Auto-Include) */
  statsOnly?: boolean;
  /** Render only the category filter badges */
  badgesOnly?: boolean;
}

export function CategoryFilterBar({
  contexts,
  categoryFilter,
  setCategoryFilter,
  statsOnly,
  badgesOnly,
}: CategoryFilterBarProps) {
  // Get unique categories from contexts
  const availableCategories = (() => {
    const cats = new Set<string>();
    contexts.forEach((ctx) => {
      if (ctx.category) cats.add(ctx.category);
    });
    CONTEXT_CATEGORIES.forEach((cat) => cats.add(cat));
    return Array.from(cats).sort();
  })();

  // Count contexts by category
  const categoryCounts = (() => {
    const counts: Record<string, number> = { all: contexts.length };
    contexts.forEach((ctx) => {
      const cat = ctx.category || "uncategorized";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  })();

  if (contexts.length === 0) return null;

  const showStats = !badgesOnly;
  const showBadges = !statsOnly;

  return (
    <>
      {/* Stats */}
      {showStats && (
        <div className="flex gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
            <span className="text-xs text-text-muted">Total Contexts:</span>
            <span className="text-sm font-bold text-brand-success">
              {contexts.length}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
            <span className="text-xs text-text-muted">With Auto-Include:</span>
            <span className="text-sm font-bold text-brand-primary">
              {
                contexts.filter((c) => countAutoIncludeRules(c.autoInclude) > 0)
                  .length
              }
            </span>
          </div>
        </div>
      )}

      {/* Category Badges */}
      {showBadges && (
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={categoryFilter === "all" ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              categoryFilter === "all"
                ? "bg-brand-success text-black border-brand-success"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setCategoryFilter("all")}
          >
            All ({categoryCounts.all || 0})
          </Badge>
          {availableCategories.map((cat) => (
            <Badge
              key={cat}
              variant={categoryFilter === cat ? "default" : "outline"}
              className={`cursor-pointer transition-all ${
                categoryFilter === cat
                  ? "text-black"
                  : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
              }`}
              style={
                categoryFilter === cat
                  ? {
                      backgroundColor: getCategoryColor(cat),
                      borderColor: getCategoryColor(cat),
                    }
                  : {}
              }
              onClick={() => setCategoryFilter(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)} (
              {categoryCounts[cat] || 0})
            </Badge>
          ))}
          {(categoryCounts.uncategorized ?? 0) > 0 && (
            <Badge
              variant={
                categoryFilter === "uncategorized" ? "default" : "outline"
              }
              className={`cursor-pointer transition-all ${
                categoryFilter === "uncategorized"
                  ? "bg-surface-raised text-text-primary border-border-default"
                  : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
              }`}
              onClick={() => setCategoryFilter("uncategorized")}
            >
              Uncategorized ({categoryCounts.uncategorized})
            </Badge>
          )}
        </div>
      )}
    </>
  );
}
