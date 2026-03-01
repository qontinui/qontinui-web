"use client";

import React, { useState, useEffect } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getCategoryLabel,
  type PackageCategory,
  type SearchFilters,
} from "@/types/code-packages";

interface PackageSearchBarProps {
  onSearch: (filters: SearchFilters) => void;
  initialFilters?: SearchFilters;
  className?: string;
}

const CATEGORIES: PackageCategory[] = [
  "automation",
  "utilities",
  "integrations",
  "patterns",
  "workflows",
  "testing",
  "data-processing",
  "ai-ml",
  "web-scraping",
  "other",
];

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "recent", label: "Recently Updated" },
  { value: "rating", label: "Highest Rated" },
  { value: "downloads", label: "Most Downloads" },
  { value: "name", label: "Name (A-Z)" },
] as const;

export function PackageSearchBar({
  onSearch,
  initialFilters,
  className,
}: PackageSearchBarProps) {
  const [query, setQuery] = useState(initialFilters?.query || "");
  const [selectedCategory, setSelectedCategory] = useState<
    PackageCategory | undefined
  >(initialFilters?.category);
  const [verifiedOnly, setVerifiedOnly] = useState(
    initialFilters?.verified_only || false
  );
  const [sortBy, setSortBy] = useState<SearchFilters["sort_by"]>(
    initialFilters?.sort_by || "popular"
  );
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Trigger search when filters change
  useEffect(() => {
    const filters: SearchFilters = {
      query: debouncedQuery || undefined,
      category: selectedCategory,
      verified_only: verifiedOnly,
      sort_by: sortBy,
    };
    onSearch(filters);
  }, [debouncedQuery, selectedCategory, verifiedOnly, sortBy, onSearch]);

  const handleClearSearch = () => {
    setQuery("");
  };

  const handleClearFilters = () => {
    setSelectedCategory(undefined);
    setVerifiedOnly(false);
    setSortBy("popular");
    setQuery("");
  };

  const activeFiltersCount = [
    selectedCategory,
    verifiedOnly,
    sortBy !== "popular",
  ].filter(Boolean).length;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Main Search Bar */}
      <div className="flex gap-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            type="text"
            placeholder="Search packages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-10 bg-surface-canvas/50 border-border-default focus:border-brand-primary"
          />
          {query && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sort Dropdown */}
        <Select
          value={sortBy}
          onValueChange={(value) =>
            setSortBy(value as SearchFilters["sort_by"])
          }
        >
          <SelectTrigger className="w-[180px] bg-surface-canvas/50 border-border-default">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Filters Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="relative bg-surface-canvas/50 border-border-default"
            >
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Filters
              {activeFiltersCount > 0 && (
                <Badge
                  variant="default"
                  className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center bg-brand-primary text-white text-xs"
                >
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter by</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Verified Only */}
            <DropdownMenuCheckboxItem
              checked={verifiedOnly}
              onCheckedChange={setVerifiedOnly}
            >
              Verified packages only
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Category</DropdownMenuLabel>

            {/* Categories */}
            {CATEGORIES.map((category) => (
              <DropdownMenuCheckboxItem
                key={category}
                checked={selectedCategory === category}
                onCheckedChange={(checked) => {
                  setSelectedCategory(checked ? category : undefined);
                }}
              >
                {getCategoryLabel(category)}
              </DropdownMenuCheckboxItem>
            ))}

            {activeFiltersCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <Button
                  variant="ghost"
                  className="w-full justify-center text-xs"
                  onClick={handleClearFilters}
                >
                  Clear all filters
                </Button>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Active Filter Chips */}
      {(selectedCategory || verifiedOnly) && (
        <div className="flex flex-wrap gap-2">
          {selectedCategory && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-surface-raised"
              onClick={() => setSelectedCategory(undefined)}
            >
              Category: {getCategoryLabel(selectedCategory)}
              <X className="w-3 h-3" />
            </Badge>
          )}
          {verifiedOnly && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-surface-raised"
              onClick={() => setVerifiedOnly(false)}
            >
              Verified only
              <X className="w-3 h-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
