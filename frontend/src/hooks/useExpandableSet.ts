import { useState, useCallback } from "react";

/**
 * Generic hook for managing a set of expanded/toggled IDs.
 *
 * Common use cases: collapsible rows, tree nodes, accordion sections.
 *
 * @param initialIds - Optional iterable of initially expanded IDs.
 */
export function useExpandableSet<T = string>(initialIds?: Iterable<T>) {
  const [expanded, setExpanded] = useState<Set<T>>(
    () => new Set(initialIds ?? [])
  );

  const toggle = useCallback((id: T) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback((id: T) => expanded.has(id), [expanded]);

  const expandAll = useCallback((ids: Iterable<T>) => {
    setExpanded(new Set(ids));
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return { expanded, toggle, isExpanded, expandAll, collapseAll, setExpanded };
}
