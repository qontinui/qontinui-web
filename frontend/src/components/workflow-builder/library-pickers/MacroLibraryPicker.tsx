"use client";

import React, { useMemo } from "react";
import { LibraryPickerBase, type LibraryItem } from "./LibraryPickerBase";
import { useMacrosDetailed } from "@/lib/runner-api";

interface MacroLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function MacroLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: MacroLibraryPickerProps) {
  const { data: macros, isLoading } = useMacrosDetailed();

  const items = useMemo<LibraryItem[] | null>(() => {
    if (!macros) return null;
    return macros.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      type: "macro",
      updated_at: m.modified_at,
    }));
  }, [macros]);

  // Build a lookup for step counts
  const stepCountMap = useMemo(() => {
    if (!macros) return new Map<string, number>();
    return new Map(macros.map((m) => [m.id, m.steps?.length ?? 0]));
  }, [macros]);

  return (
    <LibraryPickerBase
      title="Select Macro"
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      isLoading={isLoading}
      onSelect={onSelect}
      renderItem={(item) => (
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-200 truncate">{item.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500">
              {stepCountMap.get(item.id) ?? 0} step
              {(stepCountMap.get(item.id) ?? 0) !== 1 ? "s" : ""}
            </span>
            {item.description && (
              <>
                <span className="text-xs text-zinc-600">·</span>
                <span className="text-xs text-zinc-500 truncate">
                  {item.description}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    />
  );
}
