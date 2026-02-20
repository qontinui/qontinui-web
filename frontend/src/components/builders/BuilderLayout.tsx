"use client";

import { useState, useMemo, useEffect, type ReactNode } from "react";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import {
  Plus,
  Search,
  Trash2,
  CheckSquare,
  X,
  type LucideIcon,
} from "lucide-react";

export interface BuilderItem {
  id: string;
  name: string;
  description?: string | null;
  updated_at?: string;
  created_at?: string;
}

interface BuilderLayoutProps<T extends BuilderItem> {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  accentColor: string;
  items: T[] | null;
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  selectedItem: T | null;
  onSelect: (item: T | null) => void;
  onNew: () => void;
  onDelete: (ids: string[]) => Promise<void>;
  refetch: () => Promise<void>;
  renderListItem: (item: T, isSelected: boolean) => ReactNode;
  renderListActions?: (item: T) => ReactNode;
  renderEditor: (item: T) => ReactNode;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  itemLabel?: string;
  searchPlaceholder?: string;
  initialSelectedId?: string | null;
}

export function BuilderLayout<T extends BuilderItem>({
  title,
  icon: Icon,
  iconColor,
  accentColor,
  items,
  isLoading,
  error,
  isOffline,
  selectedItem,
  onSelect,
  onNew,
  onDelete,
  refetch,
  renderListItem,
  renderListActions,
  renderEditor,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyDescription,
  itemLabel = "item",
  searchPlaceholder,
  initialSelectedId,
}: BuilderLayoutProps<T>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [initialSelectDone, setInitialSelectDone] = useState(false);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  }, [items, searchQuery]);

  // Auto-select item from URL parameter
  useEffect(() => {
    if (initialSelectedId && items && items.length > 0 && !initialSelectDone) {
      const found = items.find((i) => i.id === initialSelectedId);
      if (found) {
        onSelect(found);
        setInitialSelectDone(true);
      }
    }
  }, [initialSelectedId, items, initialSelectDone, onSelect]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    await onDelete(Array.from(selectedIds));
    exitSelectionMode();
    setDeleteOpen(false);
  };

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  const itemCount = items?.length ?? 0;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left Panel - List */}
      <div className="w-80 shrink-0 border-r border-border-subtle/50 flex flex-col bg-surface-canvas/50">
        {/* Header */}
        <div className="p-4 border-b border-border-subtle/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Icon className={`size-5 ${iconColor}`} />
              <h2 className="font-semibold text-text-primary text-sm">
                {title}
              </h2>
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {itemCount}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              {selectionMode ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-red-400 hover:text-red-300"
                    disabled={selectedIds.size === 0}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={exitSelectionMode}
                  >
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setSelectionMode(true)}
                    disabled={itemCount === 0}
                  >
                    <CheckSquare className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-2 ${iconColor}`}
                    onClick={onNew}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
            <Input
              placeholder={searchPlaceholder ?? `Search ${itemLabel}s...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm bg-surface-raised/50 border-border-subtle"
            />
          </div>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-14 w-full bg-surface-raised/50 rounded-lg"
                />
              ))}
            </div>
          ) : error ? (
            <div className="p-4 text-center">
              <p className="text-sm text-red-400 mb-2">{error}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6 text-center">
              <EmptyIcon className="size-10 mx-auto mb-2 text-text-muted" />
              <p className="text-sm text-text-secondary mb-1">
                {searchQuery
                  ? `No ${itemLabel}s match your search`
                  : emptyTitle}
              </p>
              <p className="text-xs text-text-muted">
                {searchQuery ? "Try a different search term" : emptyDescription}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {filteredItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`group/item relative flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors
                      ${isSelected ? `bg-${accentColor}-500/10 border border-${accentColor}-500/30` : "border border-transparent hover:bg-surface-raised/60"}
                    `}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelection(item.id);
                      } else {
                        onSelect(isSelected ? null : item);
                      }
                    }}
                  >
                    {selectionMode && (
                      <Checkbox
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={() => toggleSelection(item.id)}
                        className="shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {renderListItem(item, isSelected)}
                    </div>
                    {renderListActions && !selectionMode && (
                      <div
                        className="absolute right-1.5 top-1.5 opacity-0 group-hover/item:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderListActions(item)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-border-subtle/50 text-xs text-text-muted text-center">
          {selectionMode
            ? `${selectedIds.size} selected`
            : `${filteredItems.length} ${itemLabel}${filteredItems.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {/* Right Panel - Editor */}
      <div className="flex-1 overflow-y-auto bg-surface-canvas">
        {selectedItem ? (
          renderEditor(selectedItem)
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Icon
                className={`size-12 mx-auto mb-3 ${iconColor} opacity-30`}
              />
              <p className="text-sm text-text-muted">
                Select a {itemLabel} to edit, or create a new one
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Batch Delete Dialog */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleBatchDelete}
        title={`Delete ${selectedIds.size} ${itemLabel}${selectedIds.size !== 1 ? "s" : ""}`}
        count={selectedIds.size}
      />
    </div>
  );
}
