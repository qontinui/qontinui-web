"use client";

/**
 * Global Search Component
 *
 * A powerful command palette (Cmd/Ctrl+K) for searching across all resources.
 * Inspired by Linear, Notion, and VS Code command palettes.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Workflow,
  Box,
  Image as ImageIcon,
  GitBranch,
  Folder,
  Zap,
  FileText,
  TestTube,
  Clock,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  globalSearchService,
  type SearchResultItem,
  type SearchFilter,
  type ResourceType,
  type RecentSearch,
} from "@/services/global-search-service";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface GlobalSearchProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// ============================================================================
// Resource Type Icons
// ============================================================================

const RESOURCE_ICONS: Record<ResourceType, typeof Workflow> = {
  workflow: Workflow,
  state: Box,
  image: ImageIcon,
  transition: GitBranch,
  folder: Folder,
  action: Zap,
  component: FileText,
  test: TestTube,
  documentation: FileText,
};

const RESOURCE_LABELS: Record<ResourceType, string> = {
  workflow: "Workflow",
  state: "State",
  image: "Image",
  transition: "Transition",
  folder: "Folder",
  action: "Action",
  component: "Component",
  test: "Test",
  documentation: "Documentation",
};

// ============================================================================
// Component
// ============================================================================

export function GlobalSearch({
  open: controlledOpen,
  onOpenChange,
}: GlobalSearchProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [activeFilters, setActiveFilters] = useState<SearchFilter>({});
  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const resultRefs = useRef<(HTMLDivElement | null)[]>([]);

  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // ============================================================================
  // Keyboard Shortcut (Cmd/Ctrl + K)
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  // ============================================================================
  // Load Recent Searches
  // ============================================================================

  useEffect(() => {
    if (open) {
      setRecentSearches(globalSearchService.getRecentSearches());
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // ============================================================================
  // Debounced Search
  // ============================================================================

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
    []
  );

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(query, activeFilters);
      }, 300); // 300ms debounce
    } else {
      setResults([]);
      setLoading(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, activeFilters, performSearch]);

  // ============================================================================
  // Keyboard Navigation
  // ============================================================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        handleResultClick(results[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleResultClick is stable and depends on router/query/activeFilters which are already tracked
    [results, selectedIndex, setOpen]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (resultRefs.current[selectedIndex]) {
      resultRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  // ============================================================================
  // Result Actions
  // ============================================================================

  const handleResultClick = useCallback(
    (result: SearchResultItem) => {
      // Save to recent searches
      globalSearchService.saveRecentSearch(query, activeFilters);

      // Navigate based on resource type
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

  const handleRecentSearchClick = useCallback((recent: RecentSearch) => {
    setQuery(recent.query);
    setActiveFilters(recent.filters);
  }, []);

  const handleClearRecent = useCallback(() => {
    globalSearchService.clearRecentSearches();
    setRecentSearches([]);
  }, []);

  // ============================================================================
  // Filter Toggles
  // ============================================================================

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

  // ============================================================================
  // Group Results by Type
  // ============================================================================

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

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-3xl p-0 gap-0 h-[600px] flex flex-col"
        showCloseButton={false}
      >
        {/* Search Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-3 mb-3">
            <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <Input
              type="text"
              placeholder="Search workflows, states, images, transitions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="border-0 focus-visible:ring-0 shadow-none px-0 h-auto text-base"
              autoFocus
            />
            {loading && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ESC
            </kbd>
          </div>

          {/* Type Filters */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                "workflow",
                "state",
                "image",
                "transition",
                "folder",
              ] as ResourceType[]
            ).map((type) => {
              const Icon = RESOURCE_ICONS[type];
              const isActive = activeFilters.types?.includes(type);

              return (
                <button
                  key={type}
                  onClick={() => toggleTypeFilter(type)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {RESOURCE_LABELS[type]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            {query.trim() === "" && recentSearches.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between px-3 py-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Recent Searches
                  </h3>
                  <button
                    onClick={handleClearRecent}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-1">
                  {recentSearches.map((recent, index) => (
                    <button
                      key={index}
                      onClick={() => handleRecentSearchClick(recent)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm flex-1">{recent.query}</span>
                      {recent.filters.types &&
                        recent.filters.types.length > 0 && (
                          <div className="flex gap-1">
                            {recent.filters.types.map((type) => (
                              <Badge
                                key={type}
                                variant="outline"
                                className="text-xs"
                              >
                                {RESOURCE_LABELS[type]}
                              </Badge>
                            ))}
                          </div>
                        )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {query.trim() !== "" && results.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="w-12 h-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No results found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try different keywords or filters
                </p>
              </div>
            )}

            {Array.from(groupedResults.entries()).map(
              ([type, items], groupIndex) => {
                const Icon = RESOURCE_ICONS[type];

                return (
                  <div key={type} className={groupIndex > 0 ? "mt-6" : ""}>
                    <div className="flex items-center gap-2 px-3 py-2 sticky top-0 bg-background z-10">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {RESOURCE_LABELS[type]}
                      </h3>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {items.length}
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      {items.map((result) => {
                        const globalIndex = results.indexOf(result);
                        const isSelected = globalIndex === selectedIndex;

                        return (
                          <div
                            key={result.id}
                            ref={(el) => {
                              resultRefs.current[globalIndex] = el;
                            }}
                            onClick={() => handleResultClick(result)}
                            onMouseEnter={() => setSelectedIndex(globalIndex)}
                            className={cn(
                              "px-3 py-2.5 rounded-md cursor-pointer transition-colors",
                              isSelected ? "bg-accent" : "hover:bg-accent/50"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium text-sm truncate">
                                    {result.name}
                                  </span>
                                  {result.breadcrumb &&
                                    result.breadcrumb.length > 0 && (
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        {result.breadcrumb.map((crumb, i) => (
                                          <span
                                            key={i}
                                            className="flex items-center gap-1"
                                          >
                                            <ChevronRight className="w-3 h-3" />
                                            {crumb}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                </div>

                                {result.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">
                                    {result.description}
                                  </p>
                                )}

                                {result.matches.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-1.5">
                                    {result.matches
                                      .slice(0, 3)
                                      .map((match, i) => (
                                        <Badge
                                          key={i}
                                          variant="outline"
                                          className="text-xs font-normal"
                                        >
                                          {match.field}: {match.matchedText}
                                        </Badge>
                                      ))}
                                  </div>
                                )}
                              </div>

                              {isSelected && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                                    ↵
                                  </kbd>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </ScrollArea>

        {/* Footer with Keyboard Shortcuts */}
        <div className="border-t p-3 bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium">
                  ↑↓
                </kbd>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium">
                  ↵
                </kbd>
                <span>Select</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium">
                  ESC
                </kbd>
                <span>Close</span>
              </div>
            </div>
            <div className="text-xs">
              {results.length > 0 &&
                `${results.length} result${results.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Hook for Programmatic Control
// ============================================================================

export function useGlobalSearch() {
  const [open, setOpen] = useState(false);

  return {
    open,
    openSearch: () => setOpen(true),
    closeSearch: () => setOpen(false),
  };
}
