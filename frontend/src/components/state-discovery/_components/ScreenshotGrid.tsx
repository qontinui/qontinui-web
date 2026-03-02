import React from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Image as ImageIcon,
  Search,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import type { ScreenshotGridProps } from "../snapshot-selector-types";

const ScreenshotGrid: React.FC<ScreenshotGridProps> = ({
  selectedSnapshot,
  screenshots,
  loading,
  filteredScreenshots,
  selectedScreenshots,
  uniqueStates,
  stateScreenshotCounts,
  searchQuery,
  onSearchQueryChange,
  onToggleScreenshot,
  onSelectAll,
  onClearAll,
  onSelectAllWithState,
}) => {
  if (!selectedSnapshot) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="text-center">
          <ImageIcon className="w-16 h-16 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Select a snapshot run to view screenshots</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full flex flex-col">
      {/* Header with search and actions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            Screenshots ({screenshots.length})
          </h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onSelectAll}
              disabled={filteredScreenshots.length === 0}
            >
              Select All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onClearAll}
              disabled={selectedScreenshots.size === 0}
            >
              Clear
            </Button>
            {uniqueStates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={uniqueStates.length === 0}
                  >
                    By State <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[300px] overflow-y-auto"
                >
                  {uniqueStates.map((state) => (
                    <DropdownMenuItem
                      key={state}
                      onClick={() => onSelectAllWithState(state)}
                      className="cursor-pointer"
                    >
                      <span className="flex items-center justify-between w-full">
                        <span className="truncate">{state}</span>
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {stateScreenshotCounts.get(state) || 0}
                        </Badge>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Active States Chips */}
        {uniqueStates.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-text-secondary">
              Active States in This Run:
            </div>
            <div className="flex flex-wrap gap-1">
              {uniqueStates.map((state) => (
                <TooltipProvider key={state}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-colors"
                        onClick={() => onSelectAllWithState(state)}
                      >
                        {state}: {stateScreenshotCounts.get(state) || 0}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Click to select all{" "}
                        {stateScreenshotCounts.get(state) || 0} screenshots with
                        this state
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-text-muted" />
          <Input
            placeholder="Search by filename or state..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Selection count */}
        {selectedScreenshots.size > 0 && (
          <Badge variant="secondary">{selectedScreenshots.size} selected</Badge>
        )}
      </div>

      {/* Screenshot grid */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
        </div>
      )}

      {!loading && filteredScreenshots.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No screenshots found</p>
        </div>
      )}

      {!loading && filteredScreenshots.length > 0 && (
        <ScrollArea className="flex-1">
          <div className="grid grid-cols-2 gap-3 pr-4">
            {filteredScreenshots.map((screenshot) => {
              const isSelected = selectedScreenshots.has(screenshot.path);

              return (
                <div
                  key={screenshot.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggleScreenshot(screenshot.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleScreenshot(screenshot.path);
                    }
                  }}
                  className={`
                    relative group cursor-pointer rounded-lg border-2 overflow-hidden transition-all
                    ${
                      isSelected
                        ? "border-blue-500 ring-2 ring-blue-200"
                        : "border-border-subtle hover:border-border-default"
                    }
                  `}
                >
                  {/* Screenshot image */}
                  <div className="aspect-video bg-surface-raised flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={screenshot.url}
                      alt={screenshot.path}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  </div>

                  {/* Info overlay */}
                  <div className="p-2 bg-white">
                    <div className="flex items-center justify-between">
                      <p className="text-xs truncate flex-1">
                        {screenshot.path.split("/").pop()}
                      </p>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() =>
                          onToggleScreenshot(screenshot.path)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Active states */}
                    {screenshot.active_states.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {screenshot.active_states.slice(0, 2).map((state) => (
                          <Badge
                            key={state}
                            variant="secondary"
                            className="text-xs px-1 py-0"
                          >
                            {state}
                          </Badge>
                        ))}
                        {screenshot.active_states.length > 2 && (
                          <Badge
                            variant="secondary"
                            className="text-xs px-1 py-0"
                          >
                            +{screenshot.active_states.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Selection indicator */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default ScreenshotGrid;
