import React from "react";
import { Search, Filter } from "lucide-react";
import type { DifficultyLevel } from "@/types/tutorial";
import type { CompletionFilter } from "../_types/tutorial-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TutorialFilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  difficultyFilter: DifficultyLevel | "all";
  onDifficultyChange: (value: DifficultyLevel | "all") => void;
  completionFilter: CompletionFilter;
  onCompletionChange: (value: CompletionFilter) => void;
  categories: string[];
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function TutorialFilterBar({
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  difficultyFilter,
  onDifficultyChange,
  completionFilter,
  onCompletionChange,
  categories,
  hasActiveFilters,
  onClearFilters,
}: TutorialFilterBarProps) {
  return (
    <div className="flex-shrink-0 p-6 space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search tutorials..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
          aria-label="Search tutorials"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters:</span>
        </div>

        <Select value={categoryFilter} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-[180px]" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((category) => (
              <SelectItem
                key={category}
                value={category}
                className="capitalize"
              >
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={difficultyFilter}
          onValueChange={(value) =>
            onDifficultyChange(value as DifficultyLevel | "all")
          }
        >
          <SelectTrigger
            className="w-[180px]"
            aria-label="Filter by difficulty"
          >
            <SelectValue placeholder="Difficulty" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="beginner">Beginner</SelectItem>
            <SelectItem value="intermediate">Intermediate</SelectItem>
            <SelectItem value="advanced">Advanced</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={completionFilter}
          onValueChange={(value) =>
            onCompletionChange(value as CompletionFilter)
          }
        >
          <SelectTrigger
            className="w-[180px]"
            aria-label="Filter by completion status"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="not-started">Not Started</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="ml-auto"
          >
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
}
