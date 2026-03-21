import React from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { DiscoveredSpec, SpecGroup } from "@/lib/spec-prompt-builder";

interface SpecGroupListProps {
  selectedCount: number;
  totalGroups: number;
  specsByPage: Map<
    string,
    { spec: DiscoveredSpec; groups: SpecGroup[]; appName?: string }
  >;
  selectedGroupIds: Set<string>;
  collapsedPages: Set<string>;
  getPageCheckState: (
    pageUrl: string
  ) => "checked" | "unchecked" | "indeterminate";
  onSelectAll: () => void;
  onSelectNone: () => void;
  onClearAll: () => void;
  onTogglePage: (pageUrl: string) => void;
  onTogglePageCollapse: (pageUrl: string) => void;
  onToggleGroup: (groupId: string) => void;
}

export function SpecGroupList({
  selectedCount,
  totalGroups,
  specsByPage,
  selectedGroupIds,
  collapsedPages,
  getPageCheckState,
  onSelectAll,
  onSelectNone,
  onClearAll,
  onTogglePage,
  onTogglePageCollapse,
  onToggleGroup,
}: SpecGroupListProps) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
      {/* Header with select all/none/clear */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Page Specs ({selectedCount}/{totalGroups})
        </span>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={onSelectAll}
            className="text-zinc-500 hover:text-zinc-200"
          >
            All
          </button>
          <span className="text-zinc-600">/</span>
          <button
            onClick={onSelectNone}
            className="text-zinc-500 hover:text-zinc-200"
          >
            None
          </button>
          <span className="text-zinc-700">|</span>
          <button
            onClick={onClearAll}
            className="text-zinc-500 hover:text-red-400 flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear All
          </button>
        </div>
      </div>

      {/* Hierarchical page -> groups display */}
      <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1">
        {Array.from(specsByPage.entries()).map(
          ([pageUrl, { groups, appName }]) => {
            const checkState = getPageCheckState(pageUrl);
            const isCollapsed = collapsedPages.has(pageUrl);
            return (
              <div key={pageUrl} className="rounded border border-zinc-700/50">
                {/* Page row */}
                <div className="flex items-center gap-2 p-1.5 hover:bg-zinc-700/20">
                  <button
                    onClick={() => onTogglePageCollapse(pageUrl)}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                  <Checkbox
                    checked={
                      checkState === "indeterminate"
                        ? "indeterminate"
                        : checkState === "checked"
                    }
                    onCheckedChange={() => onTogglePage(pageUrl)}
                    className="mt-0"
                  />
                  <span className="text-xs text-zinc-300 font-medium flex-1 truncate">
                    {pageUrl}
                  </span>
                  {appName && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 text-zinc-500 border-zinc-600 shrink-0"
                    >
                      {appName}
                    </Badge>
                  )}
                  <span className="text-[10px] text-zinc-500 shrink-0">
                    {groups.length} group
                    {groups.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Nested groups */}
                {!isCollapsed && (
                  <div className="pl-9 pb-1">
                    {groups.map((group) => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={group.id}
                        data-ui-label={`${pageUrl}: ${(group.description || group.name).slice(0, 60)}`}
                        className="flex items-start gap-2 p-1 rounded hover:bg-zinc-700/30 cursor-pointer"
                        onClick={() => onToggleGroup(group.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                      >
                        <Checkbox
                          checked={selectedGroupIds.has(group.id)}
                          onCheckedChange={() => onToggleGroup(group.id)}
                          className="mt-0.5"
                        />
                        <span className="text-xs text-zinc-400">
                          {group.description || group.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
