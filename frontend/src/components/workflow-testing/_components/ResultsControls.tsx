"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortField, SortOrder, FilterStatus } from "../test-results-types";

interface ResultsControlsProps {
  filterStatus: FilterStatus;
  onFilterChange: (status: FilterStatus) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onToggleSort: (field: SortField) => void;
}

export function ResultsControls({
  filterStatus,
  onFilterChange,
  sortField,
  sortOrder,
  onToggleSort,
}: ResultsControlsProps) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4">
        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Filter:</span>
          <Select
            value={filterStatus}
            onValueChange={(v) => onFilterChange(v as FilterStatus)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="passed">Passed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Sort by:</span>
          <SortButton
            label="Time"
            field="timestamp"
            activeField={sortField}
            sortOrder={sortOrder}
            onToggle={onToggleSort}
          />
          <SortButton
            label="Duration"
            field="duration"
            activeField={sortField}
            sortOrder={sortOrder}
            onToggle={onToggleSort}
          />
          <SortButton
            label="Status"
            field="status"
            activeField={sortField}
            sortOrder={sortOrder}
            onToggle={onToggleSort}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SortButton({
  label,
  field,
  activeField,
  sortOrder,
  onToggle,
}: {
  label: string;
  field: SortField;
  activeField: SortField;
  sortOrder: SortOrder;
  onToggle: (field: SortField) => void;
}) {
  return (
    <Button
      variant={activeField === field ? "secondary" : "ghost"}
      size="sm"
      onClick={() => onToggle(field)}
    >
      {label}
      {activeField === field &&
        (sortOrder === "asc" ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        ))}
    </Button>
  );
}
