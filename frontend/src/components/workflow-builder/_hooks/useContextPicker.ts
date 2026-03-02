import { useState, useMemo, useEffect, useRef } from "react";
import type { ContextItem } from "@/lib/runner/types/exploration";
import { groupByScope } from "../context-management-types";
import type { IncludedContext } from "../context-management-types";

export function useContextPicker(
  contexts: ContextItem[] | null,
  includedContexts: IncludedContext[]
) {
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const availableForPicker = useMemo(() => {
    if (!contexts) return [];
    const includedIds = new Set(includedContexts.map((c) => c.context.id));
    return contexts
      .filter((c) => !includedIds.has(c.id) && c.enabled !== false)
      .filter((c) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.content.toLowerCase().includes(q) ||
          c.category?.toLowerCase().includes(q) ||
          c.tags?.some((t) => t.toLowerCase().includes(q))
        );
      });
  }, [contexts, includedContexts, searchQuery]);

  const groupedAvailable = useMemo(
    () => groupByScope(availableForPicker),
    [availableForPicker]
  );

  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  const openPicker = () => setShowPicker(true);
  const closePicker = () => {
    setShowPicker(false);
    setSearchQuery("");
  };
  const togglePicker = () => {
    if (showPicker) {
      closePicker();
    } else {
      openPicker();
    }
  };

  return {
    showPicker,
    searchQuery,
    setSearchQuery,
    pickerRef,
    availableForPicker,
    groupedAvailable,
    openPicker,
    closePicker,
    togglePicker,
  };
}
