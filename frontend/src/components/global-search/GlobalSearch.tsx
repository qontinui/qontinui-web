"use client";

import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  globalSearchService,
  type SearchResultItem,
} from "@/services/global-search-service";
import { useRouter } from "next/navigation";
import type { GlobalSearchProps } from "./types";
import { useSearchState } from "./_hooks/useSearchState";
import { useSearchExecution } from "./_hooks/useSearchExecution";
import { useKeyboardNavigation } from "./_hooks/useKeyboardNavigation";
import { useGlobalShortcut } from "./_hooks/useGlobalShortcut";
import { SearchHeader } from "./_components/SearchHeader";
import { RecentSearchesList } from "./_components/RecentSearchesList";
import { SearchResultGroups } from "./_components/SearchResultGroups";
import { EmptyState } from "./_components/EmptyState";
import { SearchFooter } from "./_components/SearchFooter";

export function GlobalSearch({
  open: controlledOpen,
  onOpenChange,
}: GlobalSearchProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);

  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const {
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
  } = useSearchState();

  useGlobalShortcut(setOpen);

  useEffect(() => {
    if (open) {
      resetOnOpen();
    }
  }, [open, resetOnOpen]);

  useSearchExecution({
    query,
    activeFilters,
    setResults,
    setLoading,
    setSelectedIndex,
  });

  const handleResultClick = useCallback(
    (result: SearchResultItem) => {
      globalSearchService.saveRecentSearch(query, activeFilters);

      switch (result.type) {
        case "workflow":
          router.push(`/workflows/${result.id}`);
          break;
        case "state":
          router.push(`/states/${result.id}`);
          break;
        case "image":
          router.push(`/images/${result.id}`);
          break;
        case "transition":
          router.push(`/transitions/${result.id}`);
          break;
        case "folder":
          router.push(`/folders/${result.id}`);
          break;
        case "action":
          if (result.metadata?.workflowId) {
            router.push(
              `/workflows/${result.metadata.workflowId}?action=${result.id}`
            );
          }
          break;
      }

      setOpen(false);
    },
    [query, activeFilters, router, setOpen]
  );

  const { handleKeyDown } = useKeyboardNavigation({
    results,
    selectedIndex,
    setSelectedIndex,
    onSelect: handleResultClick,
    onClose: () => setOpen(false),
    resultRefs,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-3xl p-0 gap-0 h-[600px] flex flex-col"
        showCloseButton={false}
      >
        <SearchHeader
          query={query}
          onQueryChange={setQuery}
          onKeyDown={handleKeyDown}
          loading={loading}
          activeFilters={activeFilters}
          onToggleFilter={toggleTypeFilter}
        />

        <ScrollArea className="flex-1">
          <div className="p-2">
            {query.trim() === "" && recentSearches.length > 0 && (
              <RecentSearchesList
                recentSearches={recentSearches}
                onRecentClick={handleRecentSearchClick}
                onClear={handleClearRecent}
              />
            )}

            {query.trim() !== "" && results.length === 0 && !loading && (
              <EmptyState />
            )}

            <SearchResultGroups
              groupedResults={groupedResults}
              results={results}
              selectedIndex={selectedIndex}
              resultRefs={resultRefs}
              onResultClick={handleResultClick}
              onResultHover={setSelectedIndex}
            />
          </div>
        </ScrollArea>

        <SearchFooter resultCount={results.length} />
      </DialogContent>
    </Dialog>
  );
}

export function useGlobalSearch() {
  const [open, setOpen] = useState(false);

  return {
    open,
    openSearch: () => setOpen(true),
    closeSearch: () => setOpen(false),
  };
}
