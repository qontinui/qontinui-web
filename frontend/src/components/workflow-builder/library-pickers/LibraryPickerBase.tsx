"use client";

import React, { useState, useMemo } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface LibraryItem {
  id: string;
  name: string;
  description?: string;
  type?: string;
  updated_at?: string;
}

interface LibraryPickerBaseProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  items: LibraryItem[] | null;
  isLoading: boolean;
  onSelect: (item: LibraryItem) => void;
  renderItem?: (item: LibraryItem) => React.ReactNode;
}

export function LibraryPickerBase({
  title,
  isOpen,
  onClose,
  items,
  isLoading,
  onSelect,
  renderItem,
}: LibraryPickerBaseProps) {
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower)
    );
  }, [items, search]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            className="pl-9 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ScrollArea className="max-h-[50vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-zinc-500">Loading...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-zinc-500">
                {search ? "No items match your search" : "No items available"}
              </p>
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  className="w-full flex items-start gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition-colors"
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  {renderItem ? (
                    renderItem(item)
                  ) : (
                    <div className="min-w-0">
                      <div className="text-sm text-zinc-200 truncate">
                        {item.name}
                      </div>
                      {item.description && (
                        <div className="text-xs text-zinc-500 truncate">
                          {item.description}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
