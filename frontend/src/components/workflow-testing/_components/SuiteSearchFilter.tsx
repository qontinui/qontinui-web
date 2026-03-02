"use client";

import { Search, Filter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface SuiteSearchFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  allTags: string[];
  filterTags: string[];
  onToggleFilterTag: (tag: string) => void;
}

export function SuiteSearchFilter({
  searchQuery,
  onSearchChange,
  allTags,
  filterTags,
  onToggleFilterTag,
}: SuiteSearchFilterProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search test suites..."
            className="pl-9"
          />
        </div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Filter className="size-4" />
              Filter by tags
            </Label>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={filterTags.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => onToggleFilterTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
