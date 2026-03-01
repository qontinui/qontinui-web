/**
 * ExecutionHistoryPanel Component
 *
 * Filters for workflow execution history: has been executed,
 * last run date range, minimum success rate, and minimum run count.
 */

import React from "react";
import { Play, CheckCircle, Calendar, Hash } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Badge } from "../../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { SearchFilter, WorkflowExecutionStats } from "../types";

export interface ExecutionHistoryPanelProps {
  filter: SearchFilter;
  setFilter: (f: SearchFilter) => void;
  minSuccessRate: number | undefined;
  setMinSuccessRate: (rate: number | undefined) => void;
  minRunCount: number | undefined;
  setMinRunCount: (count: number | undefined) => void;
  executionStats?: Map<string, WorkflowExecutionStats>;
}

export function ExecutionHistoryPanel({
  filter,
  setFilter,
  minSuccessRate,
  setMinSuccessRate,
  minRunCount,
  setMinRunCount,
  executionStats,
}: ExecutionHistoryPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Play className="h-4 w-4 text-muted-foreground" />
        <Label className="font-semibold">Execution History</Label>
      </div>

      {/* Has Been Executed */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
          <Label>Has Been Executed</Label>
        </div>
        <Select
          value={
            filter.hasBeenExecuted === null ||
            filter.hasBeenExecuted === undefined
              ? "all"
              : filter.hasBeenExecuted
                ? "yes"
                : "no"
          }
          onValueChange={(value) => {
            setFilter({
              ...filter,
              hasBeenExecuted: value === "all" ? null : value === "yes",
            });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="yes">Yes - Has been run</SelectItem>
            <SelectItem value="no">No - Never run</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Last Run Date Range */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Label>Last Run Date</Label>
        </div>
        <div className="space-y-1">
          <Input
            type="date"
            placeholder="From"
            value={
              filter.lastRunDateRange?.from
                ? (filter.lastRunDateRange.from.toISOString().split("T")[0] ??
                  "")
                : ""
            }
            onChange={(e) => {
              const date = e.target.value
                ? new Date(e.target.value)
                : undefined;
              setFilter({
                ...filter,
                lastRunDateRange: {
                  ...filter.lastRunDateRange,
                  from: date,
                },
              });
            }}
          />
          <Input
            type="date"
            placeholder="To"
            value={
              filter.lastRunDateRange?.to
                ? filter.lastRunDateRange.to.toISOString().split("T")[0]
                : ""
            }
            onChange={(e) => {
              const date = e.target.value
                ? new Date(e.target.value)
                : undefined;
              setFilter({
                ...filter,
                lastRunDateRange: {
                  ...filter.lastRunDateRange,
                  to: date,
                },
              });
            }}
          />
        </div>
      </div>

      {/* Minimum Success Rate */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
          <Label>Min Success Rate</Label>
          {minSuccessRate !== undefined && (
            <Badge variant="outline" className="ml-auto">
              {minSuccessRate}%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="e.g., 80"
            value={minSuccessRate ?? ""}
            onChange={(e) => {
              const val = e.target.value
                ? parseInt(e.target.value, 10)
                : undefined;
              setMinSuccessRate(
                val !== undefined && !isNaN(val)
                  ? Math.min(100, Math.max(0, val))
                  : undefined
              );
            }}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">%</span>
          {minSuccessRate !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMinSuccessRate(undefined)}
              className="h-8 px-2"
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Only show workflows with at least this success rate
        </p>
      </div>

      {/* Minimum Run Count */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <Label>Min Run Count</Label>
          {minRunCount !== undefined && (
            <Badge variant="outline" className="ml-auto">
              {minRunCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            placeholder="e.g., 5"
            value={minRunCount ?? ""}
            onChange={(e) => {
              const val = e.target.value
                ? parseInt(e.target.value, 10)
                : undefined;
              setMinRunCount(
                val !== undefined && !isNaN(val) && val >= 0 ? val : undefined
              );
            }}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">runs</span>
          {minRunCount !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMinRunCount(undefined)}
              className="h-8 px-2"
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Only show workflows that have been run at least this many times
        </p>
      </div>

      {/* Info note when no execution stats provided */}
      {!executionStats && (
        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
          Execution history filters require execution statistics data. These
          filters will have no effect without execution stats.
        </div>
      )}
    </div>
  );
}
