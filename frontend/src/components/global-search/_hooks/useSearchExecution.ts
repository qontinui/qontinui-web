import { useEffect, useCallback, useRef } from "react";
import {
  globalSearchService,
  type SearchResultItem,
  type SearchFilter,
} from "@/services/global-search-service";

interface UseSearchExecutionArgs {
  query: string;
  activeFilters: SearchFilter;
  setResults: (results: SearchResultItem[]) => void;
  setLoading: (loading: boolean) => void;
  setSelectedIndex: (index: number) => void;
}

export function useSearchExecution({
  query,
  activeFilters,
  setResults,
  setLoading,
  setSelectedIndex,
}: UseSearchExecutionArgs) {
  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const performSearch = useCallback(
    async (searchQuery: string, filters: SearchFilter) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const searchResults = await globalSearchService.searchAll(
          searchQuery,
          filters
        );
        setResults(searchResults.items);
        setSelectedIndex(0);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [setResults, setLoading, setSelectedIndex]
  );

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(query, activeFilters);
      }, 300);
    } else {
      setResults([]);
      setLoading(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, activeFilters, performSearch, setResults, setLoading]);
}
