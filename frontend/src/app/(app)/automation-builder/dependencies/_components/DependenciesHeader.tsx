"use client";

import React from "react";
import {
  NetworkIcon,
  AlertCircle,
  Download,
  Search,
  Filter,
  RefreshCw,
  Trash2,
  Target,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FilterState } from "../dependencies-types";

interface DependenciesHeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  filters: FilterState;
  setFilters: (
    update: Partial<FilterState> | ((prev: FilterState) => FilterState)
  ) => void;
  onAnalyzeAll: () => void;
  onDetectCircular: () => void;
  onFindUnused: () => void;
  onExportReport: () => void;
}

export function DependenciesHeader({
  searchQuery,
  setSearchQuery,
  filtersOpen,
  setFiltersOpen,
  filters,
  setFilters,
  onAnalyzeAll,
  onDetectCircular,
  onFindUnused,
  onExportReport,
}: DependenciesHeaderProps) {
  return (
    <div className="border-b border-border bg-background px-6 py-3 space-y-3 shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <NetworkIcon className="size-5" />
          <h1 className="text-lg font-semibold">Workflow Dependencies</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onAnalyzeAll}>
            <RefreshCw className="size-4" />
            Analyze All
          </Button>
          <Button variant="outline" size="sm" onClick={onDetectCircular}>
            <AlertCircle className="size-4" />
            Detect Circular
          </Button>
          <Button variant="outline" size="sm" onClick={onFindUnused}>
            <Trash2 className="size-4" />
            Find Unused
          </Button>
          <Button variant="outline" size="sm" onClick={onExportReport}>
            <Download className="size-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="default"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Filter className="size-4" />
          Filters
          {filtersOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      </div>

      {/* Filters Panel */}
      {filtersOpen && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Category</p>
                <div className="flex flex-wrap gap-2">
                  {["Main", "Helper", "Utility", "Test"].map((cat) => (
                    <Button
                      key={cat}
                      variant={
                        filters.categories.includes(cat) ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          categories: prev.categories.includes(cat)
                            ? prev.categories.filter((c) => c !== cat)
                            : [...prev.categories, cat],
                        }));
                      }}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Options</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={filters.showOnlyIssues ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        showOnlyIssues: !prev.showOnlyIssues,
                      }))
                    }
                  >
                    <AlertCircle className="size-4" />
                    Only Issues
                  </Button>
                  <Button
                    variant={filters.showCriticalPath ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        showCriticalPath: !prev.showCriticalPath,
                      }))
                    }
                  >
                    <Target className="size-4" />
                    Critical Path
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
