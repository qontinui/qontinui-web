import { useState, useCallback, useMemo, useRef } from "react";
import {
  globalSearchService,
  type SearchResultItem,
  type SearchFilter,
  type ResourceType,
  type RecentSearch,
} from "@/services/global-search-service";

export function useSearchState() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [activeFilters, setActiveFilters] = useState<SearchFilter>({});
  const resultRefs = useRef<(HTMLDivElement | null)[]>([]);

  const groupedResults = useMemo(() => {
    const groups = new Map<ResourceType, SearchResultItem[]>();
    for (const result of results) {
      if (!groups.has(result.type)) {
        groups.set(result.type, []);
      }
      groups.get(result.type)!.push(result);
    }
    return groups;
  }, [results]);

  const toggleTypeFilter = useCallback((type: ResourceType) => {
    setActiveFilters((prev) => {
      const types = prev.types || [];
      const index = types.indexOf(type);
      if (index === -1) {
        return { ...prev, types: [...types, type] };
      } else {
        const newTypes = types.filter((t) => t !== type);
        return { ...prev, types: newTypes.length > 0 ? newTypes : undefined };
      }
    });
  }, []);

  const resetOnOpen = useCallback(() => {
    setRecentSearches(globalSearchService.getRecentSearches());
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
  }, []);

  const handleRecentSearchClick = useCallback((recent: RecentSearch) => {
    setQuery(recent.query);
    setActiveFilters(recent.filters);
  }, []);

  const handleClearRecent = useCallback(() => {
    globalSearchService.clearRecentSearches();
    setRecentSearches([]);
  }, []);

  return {
    query,
    setQuery,
    results,
    setResults,
    loading,
    setLoading,
    selectedIndex,
    setSelectedIndex,
    recentSearches,
    activeFilters,
    resultRefs,
    groupedResults,
    toggleTypeFilter,
    resetOnOpen,
    handleRecentSearchClick,
    handleClearRecent,
  };
}
