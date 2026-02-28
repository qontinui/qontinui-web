/**
 * Snapshot Screenshot Selector Component
 * Allows selecting screenshots from imported snapshot runs for pattern creation
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  Database,
  ChevronDown,
  Info,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSnapshotList } from "@/hooks/useSnapshotList";
import { useQuery, useQueries } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import type { SnapshotRun } from "@/types/snapshots";

interface SnapshotScreenshotSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (
    screenshots: Array<{ url: string; name: string; snapshotId: string }>
  ) => void;
  stateFilter?: string[];
}

interface SnapshotScreenshot {
  path: string;
  url: string;
  active_states: string[];
  timestamp: string;
  snapshotRunId: string;
  snapshotName: string;
}

interface ThumbnailInfo {
  url: string;
  active_states: string[];
  action_number: number;
  timestamp: string;
}

interface ThumbnailData {
  run_id: string;
  thumbnails: ThumbnailInfo[];
  total_screenshots: number;
}

const SnapshotScreenshotSelector: React.FC<SnapshotScreenshotSelectorProps> = ({
  isOpen,
  onClose,
  onSelect,
  stateFilter = [],
}) => {
  const { snapshots, loading: snapshotsLoading } = useSnapshotList();
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotRun | null>(
    null
  );
  const [selectedScreenshots, setSelectedScreenshots] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState("");

  // Reset when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedSnapshot(null);
      setSelectedScreenshots(new Set());
      setSearchQuery("");
    }
  }, [isOpen]);

  // Load thumbnails for each snapshot in parallel using useQueries
  const thumbnailQueries = useQueries({
    queries: (isOpen && !snapshotsLoading ? snapshots : []).map((snapshot) => ({
      queryKey: ["snapshotThumbnails", snapshot.run_id] as const,
      queryFn: async ({
        signal,
      }: {
        signal: AbortSignal;
      }): Promise<ThumbnailData> => {
        const response = await fetch(
          `/api/integration-testing/snapshots/${snapshot.run_id}/thumbnails?limit=4`,
          { signal }
        );
        if (!response.ok) {
          throw new Error("Failed to load thumbnails");
        }
        return response.json();
      },
      staleTime: 5 * 60 * 1000,
      enabled: isOpen && !snapshotsLoading,
    })),
  });

  // Build thumbnail cache map from query results
  const thumbnailCache = useMemo(() => {
    const cache = new Map<string, ThumbnailData>();
    if (!isOpen || snapshotsLoading) return cache;
    snapshots.forEach((snapshot, idx) => {
      const query = thumbnailQueries[idx];
      if (query?.data) {
        cache.set(snapshot.run_id, query.data);
      }
    });
    return cache;
  }, [isOpen, snapshotsLoading, snapshots, thumbnailQueries]);

  // Build loading thumbnails set from query states
  const loadingThumbnails = useMemo(() => {
    const loading = new Set<string>();
    if (!isOpen || snapshotsLoading) return loading;
    snapshots.forEach((snapshot, idx) => {
      const query = thumbnailQueries[idx];
      if (query?.isLoading) {
        loading.add(snapshot.run_id);
      }
    });
    return loading;
  }, [isOpen, snapshotsLoading, snapshots, thumbnailQueries]);

  // Load screenshots when snapshot is selected
  const { data: screenshots = [], isLoading: loading } = useQuery({
    queryKey: ["snapshotScreenshots", selectedSnapshot?.run_id],
    queryFn: async ({ signal }): Promise<SnapshotScreenshot[]> => {
      const response = await fetch(
        `/api/integration-testing/snapshots/${selectedSnapshot!.run_id}/screenshots`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Failed to load screenshots");
      }
      const data = await response.json();
      return data.screenshots.map(
        (s: {
          screenshot_path: string;
          active_states: string[];
          timestamp: string;
        }) => ({
          path: s.screenshot_path,
          url: `/api/integration-testing/snapshots/${selectedSnapshot!.run_id}/screenshot/${s.screenshot_path}`,
          active_states: s.active_states,
          timestamp: s.timestamp,
          snapshotRunId: selectedSnapshot!.run_id,
          snapshotName: selectedSnapshot!.run_id.substring(0, 8),
        })
      );
    },
    enabled: !!selectedSnapshot,
    staleTime: 60 * 1000,
  });

  // Analyze unique states and counts
  const uniqueStates = useMemo(() => {
    const states = new Set<string>();
    screenshots.forEach((s) =>
      s.active_states.forEach((state) => states.add(state))
    );
    return Array.from(states).sort();
  }, [screenshots]);

  const stateScreenshotCounts = useMemo(() => {
    const counts = new Map<string, number>();
    uniqueStates.forEach((state) => {
      const count = screenshots.filter((s) =>
        s.active_states.includes(state)
      ).length;
      counts.set(state, count);
    });
    return counts;
  }, [screenshots, uniqueStates]);

  // Filter screenshots by state filter and search query
  const filteredScreenshots = useMemo(() => {
    return screenshots.filter((screenshot) => {
      // Apply state filter - screenshot must have ALL selected states
      if (stateFilter && stateFilter.length > 0) {
        const hasAllStates = stateFilter.every((filterState) =>
          screenshot.active_states.includes(filterState)
        );
        if (!hasAllStates) return false;
      }

      // Apply search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          screenshot.path.toLowerCase().includes(query) ||
          screenshot.active_states.some((state) =>
            state.toLowerCase().includes(query)
          )
        );
      }

      return true;
    });
  }, [screenshots, stateFilter, searchQuery]);

  // Toggle screenshot selection
  const toggleScreenshot = (path: string) => {
    const newSelection = new Set(selectedScreenshots);
    if (newSelection.has(path)) {
      newSelection.delete(path);
    } else {
      newSelection.add(path);
    }
    setSelectedScreenshots(newSelection);
  };

  // Select all filtered screenshots
  const handleSelectAll = () => {
    const allPaths = new Set(filteredScreenshots.map((s) => s.path));
    setSelectedScreenshots(allPaths);
  };

  // Clear selection
  const handleClearAll = () => {
    setSelectedScreenshots(new Set());
  };

  // Select all screenshots with a specific state
  const handleSelectAllWithState = (stateName: string) => {
    const screenshotsWithState = screenshots
      .filter((s) => s.active_states.includes(stateName))
      .map((s) => s.path);
    setSelectedScreenshots(new Set(screenshotsWithState));
    toast.success(
      `Selected ${screenshotsWithState.length} screenshots with ${stateName}`
    );
  };

  // Handle selection confirmation
  const handleConfirm = () => {
    const selected = screenshots
      .filter((s) => selectedScreenshots.has(s.path))
      .map((s) => ({
        url: s.url,
        name: `${s.snapshotName}_${s.path.split("/").pop()}`,
        snapshotId: s.snapshotRunId,
      }));

    onSelect(selected);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Select Screenshots from Snapshots</DialogTitle>
          <DialogDescription>
            Choose screenshots from imported snapshot runs to use for pattern
            creation
          </DialogDescription>
        </DialogHeader>

        {/* State Filter Indicator */}
        {stateFilter && stateFilter.length > 0 && (
          <Alert className="mb-2">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Filtering by states: {stateFilter.join(", ")}
              <span className="ml-2 text-text-muted">
                (Showing screenshots that have all selected states)
              </span>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-3 gap-4 h-[600px]">
          {/* Left: Snapshot Selection */}
          <div className="border-r pr-4">
            <h3 className="font-semibold text-sm mb-3">Snapshot Runs</h3>

            {snapshotsLoading && (
              <div className="flex items-center justify-center py-8 text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading...</span>
              </div>
            )}

            {!snapshotsLoading && snapshots.length === 0 && (
              <div className="text-center py-8 text-text-muted">
                <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No snapshots found</p>
                <p className="text-xs mt-1">Import snapshots first</p>
              </div>
            )}

            {!snapshotsLoading && snapshots.length > 0 && (
              <ScrollArea className="h-[540px]">
                <div className="space-y-2">
                  {snapshots.map((snapshot) => {
                    const thumbnails = thumbnailCache.get(snapshot.run_id);
                    const isLoadingThumbs = loadingThumbnails.has(
                      snapshot.run_id
                    );

                    return (
                      <div
                        key={snapshot.id}
                        onClick={() => setSelectedSnapshot(snapshot)}
                        className={`
                          p-3 rounded-lg border cursor-pointer transition-all
                          ${
                            selectedSnapshot?.id === snapshot.id
                              ? "bg-blue-50 border-blue-300 ring-1 ring-blue-300"
                              : "bg-white border-border-subtle hover:border-border-default hover:bg-surface-raised/80"
                          }
                        `}
                      >
                        <div className="text-sm font-medium truncate">
                          {snapshot.run_id.substring(0, 12)}...
                        </div>
                        <div className="text-xs text-text-muted mt-1">
                          {formatDistanceToNow(new Date(snapshot.start_time), {
                            addSuffix: true,
                          })}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-xs text-text-secondary">
                          <span>{snapshot.total_screenshots} screenshots</span>
                          <span>•</span>
                          <span>{snapshot.total_actions} actions</span>
                        </div>

                        {/* Thumbnail Previews */}
                        {isLoadingThumbs && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-text-muted">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Loading previews...</span>
                          </div>
                        )}

                        {thumbnails && thumbnails.thumbnails.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="grid grid-cols-4 gap-1">
                              {thumbnails.thumbnails.map((thumb, idx) => (
                                <TooltipProvider key={idx}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="aspect-video bg-surface-raised rounded overflow-hidden border border-border-subtle">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={thumb.url}
                                          alt={`Thumbnail ${idx + 1}`}
                                          className="w-full h-full object-cover"
                                          loading="lazy"
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="text-xs">
                                        <div className="font-semibold mb-1">
                                          Action {thumb.action_number}
                                        </div>
                                        {thumb.active_states.length > 0 && (
                                          <div className="text-text-secondary">
                                            States:{" "}
                                            {thumb.active_states.join(", ")}
                                          </div>
                                        )}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ))}
                            </div>
                            {thumbnails.total_screenshots > 4 && (
                              <div className="text-xs text-text-muted text-center">
                                +{thumbnails.total_screenshots - 4} more
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Right: Screenshot Selection */}
          <div className="col-span-2">
            {!selectedSnapshot && (
              <div className="flex items-center justify-center h-full text-text-muted">
                <div className="text-center">
                  <ImageIcon className="w-16 h-16 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">
                    Select a snapshot run to view screenshots
                  </p>
                </div>
              </div>
            )}

            {selectedSnapshot && (
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
                        onClick={handleSelectAll}
                        disabled={filteredScreenshots.length === 0}
                      >
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearAll}
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
                                onClick={() => handleSelectAllWithState(state)}
                                className="cursor-pointer"
                              >
                                <span className="flex items-center justify-between w-full">
                                  <span className="truncate">{state}</span>
                                  <Badge
                                    variant="secondary"
                                    className="ml-2 text-xs"
                                  >
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
                                  onClick={() =>
                                    handleSelectAllWithState(state)
                                  }
                                >
                                  {state}:{" "}
                                  {stateScreenshotCounts.get(state) || 0}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  Click to select all{" "}
                                  {stateScreenshotCounts.get(state) || 0}{" "}
                                  screenshots with this state
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
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {/* Selection count */}
                  {selectedScreenshots.size > 0 && (
                    <Badge variant="secondary">
                      {selectedScreenshots.size} selected
                    </Badge>
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
                        const isSelected = selectedScreenshots.has(
                          screenshot.path
                        );

                        return (
                          <div
                            key={screenshot.path}
                            onClick={() => toggleScreenshot(screenshot.path)}
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
                                    toggleScreenshot(screenshot.path)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>

                              {/* Active states */}
                              {screenshot.active_states.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {screenshot.active_states
                                    .slice(0, 2)
                                    .map((state) => (
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
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <p className="text-sm text-text-secondary">
            {selectedScreenshots.size} screenshot
            {selectedScreenshots.size !== 1 ? "s" : ""} selected
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedScreenshots.size === 0}
            >
              Add Selected ({selectedScreenshots.size})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SnapshotScreenshotSelector;
