"use client";

import type { ExternalElement } from "@/hooks/use-inspector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface SearchPanelProps {
  elements: ExternalElement[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchFilter: "all" | "interactive" | "visible";
  onFilterChange: (f: "all" | "interactive" | "visible") => void;
  filteredElements: ExternalElement[];
  selectedElement: ExternalElement | null;
  onSelectElement: (el: ExternalElement) => void;
}

export function SearchPanel({
  elements,
  searchQuery,
  onSearchChange,
  searchFilter,
  onFilterChange,
  filteredElements,
  selectedElement,
  onSelectElement,
}: SearchPanelProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader>
        <CardTitle className="text-base text-white flex items-center gap-2">
          <Search className="w-4 h-4" />
          Search &amp; Filter Elements
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              placeholder="Search by id, type, role, text, label..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
            />
          </div>
        </div>

        <div className="flex gap-2">
          {(
            [
              { key: "all", label: "All" },
              { key: "interactive", label: "Interactive Only" },
              { key: "visible", label: "Visible Only" },
            ] as const
          ).map(({ key, label }) => (
            <Button
              key={key}
              variant={searchFilter === key ? "default" : "outline"}
              size="sm"
              onClick={() => onFilterChange(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="text-sm text-text-muted">
          {filteredElements.length} of {elements.length} elements
        </div>

        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {filteredElements.map((el) => (
            <button
              key={el.id}
              onClick={() => onSelectElement(el)}
              className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                selectedElement?.id === el.id
                  ? "border-purple-500/50 bg-purple-950/20"
                  : "border-border-subtle/30 bg-surface-canvas/30 hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-text-primary truncate flex-1">
                  {el.id}
                </span>
                {el.role && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {el.role}
                  </Badge>
                )}
                {el.type && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {el.type}
                  </Badge>
                )}
              </div>
              {(el.text || el.label) && (
                <p className="text-xs text-text-muted mt-1 truncate">
                  {el.text || el.label}
                </p>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
