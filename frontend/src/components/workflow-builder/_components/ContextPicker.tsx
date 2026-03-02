import React from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ContextItem } from "@/lib/runner/types/exploration";
import { SCOPE_ORDER, type ContextScope } from "../context-management-types";

interface ContextPickerProps {
  showPicker: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  groupedAvailable: Record<ContextScope, ContextItem[]>;
  availableCount: number;
  contexts: ContextItem[] | null;
  pickerRef: React.RefObject<HTMLDivElement | null>;
  onTogglePicker: () => void;
  onAddContext: (contextId: string) => void;
  onClose: () => void;
}

export function ContextPicker({
  showPicker,
  searchQuery,
  onSearchChange,
  groupedAvailable,
  availableCount,
  contexts,
  pickerRef,
  onTogglePicker,
  onAddContext,
  onClose,
}: ContextPickerProps) {
  return (
    <div className="relative pt-2 border-t border-zinc-800" ref={pickerRef}>
      <button
        onClick={onTogglePicker}
        className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add Context
      </button>

      {showPicker && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 max-h-72 overflow-hidden">
          <div className="p-2 border-b border-zinc-700">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search contexts..."
                className="pl-8 bg-zinc-700 border-zinc-600 text-zinc-200 text-sm h-8"
              />
            </div>
          </div>

          <div className="overflow-auto max-h-48">
            {SCOPE_ORDER.map((scope) => {
              const items = groupedAvailable[scope];
              if (items.length === 0) return null;
              return (
                <div key={scope}>
                  <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 bg-zinc-800/80 uppercase tracking-wider">
                    {scope}
                  </div>
                  {items.map((ctx) => (
                    <button
                      key={ctx.id}
                      onClick={() => onAddContext(ctx.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-700 transition-colors"
                    >
                      <Plus className="w-3 h-3 text-zinc-500 shrink-0" />
                      <span className="text-sm text-zinc-200 truncate flex-1">
                        {ctx.name}
                      </span>
                      {ctx.category && (
                        <span className="text-[10px] text-zinc-500 shrink-0">
                          {ctx.category}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
            {availableCount === 0 && (
              <div className="px-3 py-4 text-sm text-zinc-500 text-center">
                {!contexts || contexts.length === 0
                  ? "No contexts available. Is the runner connected?"
                  : "No matching contexts found"}
              </div>
            )}
          </div>

          <div className="p-2 border-t border-zinc-700">
            <button
              onClick={onClose}
              className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
