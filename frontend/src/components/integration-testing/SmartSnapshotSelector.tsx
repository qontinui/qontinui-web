// components/integration-testing/SmartSnapshotSelector.tsx

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Sparkles,
  Settings2,
  Database,
  X,
  AlertCircle,
  Info,
  Activity,
  ImageIcon,
  Star,
} from "lucide-react";
import { useSnapshotRecommendations } from "@/hooks/useSnapshotRecommendations";
import { useSnapshotList } from "@/hooks/useSnapshotList";
import { RecommendationCard } from "./RecommendationCard";
import { SnapshotDetailDialog } from "./SnapshotDetailDialog";
import type { SnapshotRun } from "@/types/snapshots";
import type { SnapshotRecommendation } from "@/types/snapshot-recommendations";
import { formatDistanceToNow } from "date-fns";

interface SmartSnapshotSelectorProps {
  selectedSnapshots: SnapshotRun[];
  onChange: (snapshots: SnapshotRun[]) => void;
  processId?: string;
}

type SelectionMode = "smart" | "manual";

export function SmartSnapshotSelector({
  selectedSnapshots,
  onChange,
  processId,
}: SmartSnapshotSelectorProps) {
  const [mode, setMode] = useState<SelectionMode>("smart");
  const [detailSnapshotId, setDetailSnapshotId] = useState<number | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Fetch recommendations (auto-fetch when processId is provided)
  const {
    recommendations,
    selectedRecommendation,
    setSelectedRecommendation,
    loading: recommendationsLoading,
    error: recommendationsError,
    refetch: refetchRecommendations,
  } = useSnapshotRecommendations({
    process_id: processId,
    max_snapshots: 3,
    num_recommendations: 3,
    autoFetch: true,
  });

  // Fetch all snapshots for manual mode
  const {
    snapshots,
    loading: snapshotsLoading,
    error: snapshotsError,
  } = useSnapshotList();

  // Handle recommendation selection
  const handleRecommendationSelect = (
    recommendation: SnapshotRecommendation
  ) => {
    setSelectedRecommendation(recommendation);
    onChange(recommendation.snapshots);
  };

  // Handle manual snapshot toggle
  const handleToggle = (snapshot: SnapshotRun) => {
    const isSelected = selectedSnapshots.some((s) => s.id === snapshot.id);

    if (isSelected) {
      onChange(selectedSnapshots.filter((s) => s.id !== snapshot.id));
    } else {
      onChange([...selectedSnapshots, snapshot]);
    }
  };

  // Handle clear all
  const handleClearAll = () => {
    onChange([]);
    setSelectedRecommendation(null);
  };

  // Handle view details
  const handleViewDetails = (snapshotId: number) => {
    setDetailSnapshotId(snapshotId);
    setDetailDialogOpen(true);
  };

  // Calculate metrics for manual mode
  const totalActions = selectedSnapshots.reduce(
    (sum, s) => sum + s.total_actions,
    0
  );
  const totalScreenshots = selectedSnapshots.reduce(
    (sum, s) => sum + s.total_screenshots,
    0
  );

  // Check if a snapshot is recommended
  const isRecommended = (snapshotId: number): boolean => {
    return recommendations.some((rec) => rec.snapshot_ids.includes(snapshotId));
  };

  // Get snapshot analysis for manual mode
  const getSnapshotMetrics = (snapshot: SnapshotRun) => {
    const successRate =
      snapshot.total_actions > 0
        ? (snapshot.successful_actions / snapshot.total_actions) * 100
        : 0;

    const isNew =
      new Date().getTime() - new Date(snapshot.start_time).getTime() <
      24 * 60 * 60 * 1000;
    const isRecent =
      new Date().getTime() - new Date(snapshot.start_time).getTime() <
      7 * 24 * 60 * 60 * 1000;

    return {
      successRate,
      recency: isNew ? "new" : isRecent ? "recent" : "old",
      priority:
        successRate >= 90 ? "high" : successRate >= 70 ? "medium" : "low",
    };
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {mode === "smart" ? (
                <>
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  Smart Recommendations
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  Manual Selection
                </>
              )}
            </CardTitle>

            <div className="flex items-center gap-2">
              {selectedSnapshots.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-7 text-xs"
                >
                  <X className="w-3 h-3 mr-1" />
                  Clear ({selectedSnapshots.length})
                </Button>
              )}

              <Button
                variant={mode === "manual" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode(mode === "smart" ? "manual" : "smart")}
                className="h-7 text-xs"
              >
                {mode === "smart" ? (
                  <>
                    <Settings2 className="w-3 h-3 mr-1" />
                    Manual Selection
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 mr-1" />
                    Smart Mode
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Selection Summary */}
          {selectedSnapshots.length > 0 && (
            <div className="text-xs text-text-muted mt-2 p-2 bg-blue-50 rounded border border-blue-200">
              <div className="font-medium text-blue-900">
                {selectedSnapshots.length} snapshot
                {selectedSnapshots.length > 1 ? "s" : ""} selected
              </div>
              <div className="text-blue-800 mt-0.5">
                Pool: {totalActions} actions, {totalScreenshots} screenshots
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {/* Smart Mode: Show Recommendations */}
          {mode === "smart" && (
            <div className="space-y-4">
              {recommendationsLoading && (
                <div className="flex items-center justify-center py-8 text-text-muted">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm">Analyzing snapshots...</span>
                </div>
              )}

              {recommendationsError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  <p className="font-medium">Error loading recommendations</p>
                  <p className="text-xs mt-1">{recommendationsError.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refetchRecommendations}
                    className="mt-2"
                  >
                    Retry
                  </Button>
                </div>
              )}

              {!recommendationsLoading &&
                !recommendationsError &&
                recommendations.length === 0 && (
                  <div className="text-center py-8 text-text-muted text-sm">
                    <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No recommendations available</p>
                    <p className="text-xs mt-1">
                      {processId
                        ? "No snapshots found for this process"
                        : "Select a process to see recommendations"}
                    </p>
                  </div>
                )}

              {!recommendationsLoading && recommendations.length > 0 && (
                <>
                  <div className="text-sm text-text-secondary bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                    <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-blue-900">
                        Smart recommendations ready
                      </p>
                      <p className="text-xs text-blue-800 mt-1">
                        Based on state coverage, action variety, and execution
                        efficiency. The top recommendation is pre-selected.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {recommendations.map((recommendation) => (
                      <RecommendationCard
                        key={recommendation.snapshot_ids.join("-")}
                        recommendation={recommendation}
                        isSelected={
                          selectedRecommendation?.snapshot_ids.join("-") ===
                          recommendation.snapshot_ids.join("-")
                        }
                        onSelect={() =>
                          handleRecommendationSelect(recommendation)
                        }
                        onViewDetails={handleViewDetails}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Manual Mode: Show Full Snapshot List */}
          {mode === "manual" && (
            <div className="space-y-4">
              {snapshotsLoading && (
                <div className="flex items-center justify-center py-8 text-text-muted">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm">Loading snapshots...</span>
                </div>
              )}

              {snapshotsError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  Error: {snapshotsError.message}
                </div>
              )}

              {!snapshotsLoading &&
                !snapshotsError &&
                snapshots.length === 0 && (
                  <div className="text-center py-8 text-text-muted text-sm">
                    <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No snapshots found</p>
                    <p className="text-xs mt-1">Import a snapshot to begin</p>
                  </div>
                )}

              {!snapshotsLoading && snapshots.length > 0 && (
                <>
                  <div className="text-sm text-text-secondary bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-yellow-900">
                        Manual selection mode
                      </p>
                      <p className="text-xs text-yellow-800 mt-1">
                        Select individual snapshots. Recommended snapshots are
                        marked with a badge.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {snapshots.map((snapshot) => {
                      const isSelected = selectedSnapshots.some(
                        (s) => s.id === snapshot.id
                      );
                      const recommended = isRecommended(snapshot.id);
                      const metrics = getSnapshotMetrics(snapshot);

                      return (
                        <div
                          key={snapshot.id}
                          role="option"
                          tabIndex={0}
                          aria-selected={isSelected}
                          className={`
                            p-3 border rounded-lg cursor-pointer transition-all
                            ${
                              isSelected
                                ? "bg-blue-50 border-blue-300 ring-1 ring-blue-300"
                                : "bg-white border-border-subtle hover:border-border-default hover:bg-surface-raised/80"
                            }
                          `}
                          onClick={() => handleToggle(snapshot)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleToggle(snapshot);
                            }
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleToggle(snapshot)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium truncate">
                                    {snapshot.run_id}
                                  </div>
                                  {recommended && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                                            <Star className="w-3 h-3 mr-1" />
                                            Recommended
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>
                                            This snapshot appears in smart
                                            recommendations
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                <div className="text-xs text-text-muted whitespace-nowrap">
                                  {formatDistanceToNow(
                                    new Date(snapshot.start_time),
                                    {
                                      addSuffix: true,
                                    }
                                  )}
                                </div>
                              </div>

                              {/* Coverage Indicators */}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        <Activity className="w-3 h-3 mr-1" />
                                        {snapshot.total_actions} actions
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>
                                        {snapshot.successful_actions} successful
                                        actions
                                      </p>
                                      <p className="text-xs text-text-secondary">
                                        {Math.round(metrics.successRate)}%
                                        success rate
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>

                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        <ImageIcon className="w-3 h-3 mr-1" />
                                        {snapshot.total_screenshots}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Screenshot count</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>

                                {metrics.recency === "new" && (
                                  <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
                                    New
                                  </Badge>
                                )}

                                {metrics.priority === "high" && (
                                  <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">
                                    High Priority
                                  </Badge>
                                )}
                              </div>

                              {snapshot.duration_seconds !== null && (
                                <div className="mt-1 text-xs text-text-muted">
                                  Duration:{" "}
                                  {Math.round(snapshot.duration_seconds)}s
                                </div>
                              )}

                              {snapshot.tags && snapshot.tags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {snapshot.tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="px-2 py-0.5 bg-surface-raised text-text-secondary rounded text-xs"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Snapshot Detail Dialog */}
      <SnapshotDetailDialog
        snapshotId={detailSnapshotId}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </>
  );
}
