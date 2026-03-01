/**
 * SearchHeader Component
 *
 * Header bar for the advanced search panel with filter status,
 * action buttons (clear, save, export), and expand/collapse toggle.
 */

import React from "react";
import {
  Filter,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";

export interface SearchHeaderProps {
  isFilterActive: boolean;
  filteredCount: number;
  isExpanded: boolean;
  setIsExpanded: (v: boolean) => void;
  onClearAll: () => void;
  onSaveFilter: () => void;
  onExportResults: () => void;
}

export function SearchHeader({
  isFilterActive,
  filteredCount,
  isExpanded,
  setIsExpanded,
  onClearAll,
  onSaveFilter,
  onExportResults,
}: SearchHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b">
      <div className="flex items-center gap-2">
        <Filter className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Advanced Search</h3>
        {isFilterActive && (
          <Badge variant="secondary" className="ml-2">
            {filteredCount} results
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isFilterActive && (
          <>
            <Button variant="ghost" size="sm" onClick={onClearAll}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Clear All
            </Button>
            <Button variant="ghost" size="sm" onClick={onSaveFilter}>
              <Save className="h-4 w-4 mr-2" />
              Save Filter
            </Button>
            <Button variant="ghost" size="sm" onClick={onExportResults}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
