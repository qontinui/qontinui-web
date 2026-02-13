/**
 * Graph Controls Component
 *
 * Top panel controls for the dependency graph including search, layout selection,
 * filtering, export dropdown, zoom controls, and summary statistics badges.
 */

"use client";

import React from "react";
import {
  Search,
  Download,
  Filter,
  LayoutGrid,
  AlertCircle,
  Network,
  Link2,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Target,
  BarChart3,
} from "lucide-react";
import { Panel } from "@xyflow/react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Badge } from "../../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { GraphControlsProps, LayoutType, FilterType } from "./types";

export function GraphControls({
  searchQuery,
  onSearch,
  layout,
  onLayoutChange,
  selectedFilter,
  onFilterChange,
  onExport,
  onZoomIn,
  onZoomOut,
  onFitView,
  onCenterOnSelected,
  selectedWorkflowId,
  showAnalysis,
  onToggleAnalysis,
  workflowCount,
  totalDependencies,
  circularCount,
  unusedCount,
}: GraphControlsProps) {
  return (
    <Panel position="top-left" className="m-2 space-y-2">
      <div className="flex gap-2 bg-background/95 backdrop-blur-sm p-2 rounded-lg shadow-lg border">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            className="pl-9 w-64"
          />
        </div>

        {/* Layout selector */}
        <Select
          value={layout}
          onValueChange={(v) => onLayoutChange(v as LayoutType)}
        >
          <SelectTrigger className="w-40">
            <LayoutGrid className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hierarchical">Hierarchical</SelectItem>
            <SelectItem value="force">Force-Directed</SelectItem>
            <SelectItem value="circular">Circular</SelectItem>
            <SelectItem value="tree">Tree</SelectItem>
          </SelectContent>
        </Select>

        {/* Filter */}
        <Select
          value={selectedFilter}
          onValueChange={(v) => onFilterChange(v as FilterType)}
        >
          <SelectTrigger className="w-40">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workflows</SelectItem>
            <SelectItem value="dependencies">Dependencies</SelectItem>
            <SelectItem value="dependents">Dependents</SelectItem>
            <SelectItem value="unused">Unused</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onExport("png")}>
              Export as PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("svg")}>
              Export as SVG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("json")}>
              Export as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("graphml")}>
              Export as GraphML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("markdown")}>
              Export Report (MD)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Zoom Controls */}
        <div className="flex gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onZoomIn}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom In</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onZoomOut}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom Out</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={onFitView}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit View</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {selectedWorkflowId && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCenterOnSelected}
                  >
                    <Target className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Center on Selected</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Toggle analysis panel */}
        <Button variant="outline" size="sm" onClick={onToggleAnalysis}>
          <BarChart3 className="h-4 w-4 mr-2" />
          {showAnalysis ? "Hide" : "Show"} Analysis
        </Button>
      </div>

      {/* Stats */}
      <div className="flex gap-2 bg-background/95 backdrop-blur-sm p-2 rounded-lg shadow-lg border">
        <Badge variant="outline">
          <Network className="h-3 w-3 mr-1" />
          {workflowCount} workflows
        </Badge>
        <Badge variant="outline">
          <Link2 className="h-3 w-3 mr-1" />
          {totalDependencies} dependencies
        </Badge>
        {circularCount > 0 && (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            {circularCount} circular
          </Badge>
        )}
        {unusedCount > 0 && (
          <Badge variant="secondary">
            <EyeOff className="h-3 w-3 mr-1" />
            {unusedCount} unused
          </Badge>
        )}
      </div>
    </Panel>
  );
}
