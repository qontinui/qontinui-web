"use client";

import { useState, useMemo } from "react";
import { Search, X, Layers, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AnalyzedElement } from "../spec-workflow-types";

// ---------------------------------------------------------------------------
// Element Picker (inline)
// ---------------------------------------------------------------------------

interface ElementPickerInlineProps {
  elements: AnalyzedElement[];
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
}

export function ElementPickerInline({
  elements,
  selectedId,
  onSelect,
}: ElementPickerInlineProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return elements;
    const q = search.toLowerCase();
    return elements.filter(
      (el) =>
        el.id.toLowerCase().includes(q) ||
        el.label.toLowerCase().includes(q) ||
        el.type.toLowerCase().includes(q) ||
        el.text?.toLowerCase().includes(q) ||
        el.selector?.toLowerCase().includes(q)
    );
  }, [elements, search]);

  return (
    <div className="border border-zinc-700 rounded-md overflow-hidden bg-zinc-900/50">
      {/* Search bar */}
      <div className="p-2 border-b border-zinc-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            placeholder="Search elements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 pr-7 text-xs bg-zinc-800 border-zinc-700"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Element list */}
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-3 text-xs text-zinc-500 text-center">
            No elements found
          </div>
        )}
        {filtered.map((el) => {
          const isActive = selectedId === el.id;
          return (
            <button
              key={el.id}
              onClick={() => onSelect(el.id)}
              className={cn(
                "w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-zinc-800/50 last:border-b-0",
                isActive
                  ? "bg-blue-500/10 border-l-2 border-l-blue-500"
                  : "hover:bg-zinc-800/60"
              )}
            >
              <Layers className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-200 truncate">{el.label}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {el.tagName}
                  {el.type !== el.tagName ? ` (${el.type})` : ""}
                  {el.text ? ` - "${el.text}"` : ""}
                </div>
                {el.selector && (
                  <div className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">
                    {el.selector}
                  </div>
                )}
              </div>
              {isActive && (
                <Check className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
