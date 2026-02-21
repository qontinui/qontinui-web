"use client";

import React, { useMemo } from "react";
import { LibraryPickerBase, type LibraryItem } from "./LibraryPickerBase";
import { usePlaywrightScriptsDetailed } from "@/lib/runner-api";

interface PlaywrightScriptLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function PlaywrightScriptLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: PlaywrightScriptLibraryPickerProps) {
  const { data: scripts, isLoading } = usePlaywrightScriptsDetailed();

  const items = useMemo<LibraryItem[] | null>(() => {
    if (!scripts) return null;
    return scripts.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: "playwright",
      updated_at: s.updated_at,
    }));
  }, [scripts]);

  // Build a lookup for target URLs
  const targetUrlMap = useMemo(() => {
    if (!scripts) return new Map<string, string | undefined>();
    return new Map(scripts.map((s) => [s.id, s.target_url]));
  }, [scripts]);

  return (
    <LibraryPickerBase
      title="Select Playwright Script"
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      isLoading={isLoading}
      onSelect={onSelect}
      renderItem={(item) => (
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-200 truncate">{item.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            {targetUrlMap.get(item.id) && (
              <span className="text-xs text-zinc-500 truncate max-w-[200px]">
                {targetUrlMap.get(item.id)}
              </span>
            )}
            {targetUrlMap.get(item.id) && item.description && (
              <span className="text-xs text-zinc-600">·</span>
            )}
            {item.description && (
              <span className="text-xs text-zinc-500 truncate">
                {item.description}
              </span>
            )}
          </div>
        </div>
      )}
    />
  );
}
