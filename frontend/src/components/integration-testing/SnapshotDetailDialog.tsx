// components/integration-testing/SnapshotDetailDialog.tsx

"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  CheckCircle2,
  Activity,
  ImageIcon,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useSnapshotAnalysis } from "@/hooks/useSnapshotAnalysis";
import { formatDistanceToNow } from "date-fns";

interface SnapshotDetailDialogProps {
  snapshotId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SnapshotDetailDialog({
  snapshotId,
  open,
  onOpenChange,
}: SnapshotDetailDialogProps) {
  const { detail, loading, error, fetchDetail } = useSnapshotAnalysis();

  useEffect(() => {
    if (open && snapshotId) {
      fetchDetail(snapshotId);
    }
  }, [open, snapshotId, fetchDetail]);

  const getRecencyBadge = (recency: string) => {
    switch (recency) {
      case "new":
        return (
          <Badge className="bg-green-100 text-green-800 border-green-300">
            New
          </Badge>
        );
      case "recent":
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-300">
            Recent
          </Badge>
        );
      case "old":
        return (
          <Badge className="bg-surface-raised text-text-primary border-border-default">
            Old
          </Badge>
        );
      default:
        return null;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "high":
        return (
          <Badge className="bg-red-100 text-red-800 border-red-300">
            High Priority
          </Badge>
        );
      case "medium":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
            Medium Priority
          </Badge>
        );
      case "low":
        return (
          <Badge className="bg-surface-raised text-text-primary border-border-default">
            Low Priority
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Snapshot Details</DialogTitle>
          <DialogDescription>
            Detailed information about the snapshot and its coverage
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            <p className="font-medium">Error loading snapshot details</p>
            <p className="text-sm mt-1">{error.message}</p>
          </div>
        )}

        {!loading && !error && detail && (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-6 pr-4">
              {/* Header Info */}
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-text-muted">Run ID</div>
                  <div className="font-mono text-sm bg-surface-raised px-3 py-2 rounded mt-1">
                    {detail.run_id}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {detail.metadata.recency &&
                    getRecencyBadge(detail.metadata.recency)}
                  {detail.metadata.priority &&
                    getPriorityBadge(detail.metadata.priority)}
                  {detail.metadata.has_duplicates && (
                    <Badge
                      variant="outline"
                      className="bg-orange-50 text-orange-800 border-orange-300"
                    >
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Has Duplicates
                    </Badge>
                  )}
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 text-blue-900">
                    <Activity className="w-4 h-4" />
                    <span className="text-xs font-medium">Actions</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-900 mt-1">
                    {detail.total_actions}
                  </div>
                  <div className="text-xs text-blue-700 mt-1">
                    {detail.successful_actions} successful
                  </div>
                </div>

                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-900">
                    <ImageIcon className="w-4 h-4" />
                    <span className="text-xs font-medium">Screenshots</span>
                  </div>
                  <div className="text-2xl font-bold text-green-900 mt-1">
                    {detail.total_screenshots}
                  </div>
                </div>

                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="flex items-center gap-2 text-purple-900">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-medium">Success Rate</span>
                  </div>
                  <div className="text-2xl font-bold text-purple-900 mt-1">
                    {Math.round(
                      (detail.successful_actions / detail.total_actions) * 100
                    )}
                    %
                  </div>
                </div>

                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center gap-2 text-orange-900">
                    <Clock className="w-4 h-4" />
                    <span className="text-xs font-medium">Duration</span>
                  </div>
                  <div className="text-2xl font-bold text-orange-900 mt-1">
                    {detail.duration_seconds
                      ? Math.round(detail.duration_seconds)
                      : "N/A"}
                  </div>
                  {detail.duration_seconds && (
                    <div className="text-xs text-orange-700 mt-1">seconds</div>
                  )}
                </div>
              </div>

              {/* Timestamp */}
              <div className="text-sm text-text-muted">
                Created{" "}
                <span className="font-medium">
                  {formatDistanceToNow(new Date(detail.start_time), {
                    addSuffix: true,
                  })}
                </span>
              </div>

              {/* States Covered */}
              <div>
                <div className="text-sm font-medium text-text-primary mb-2">
                  States Covered ({detail.states.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.states.map((state) => (
                    <Badge key={state} variant="outline" className="bg-blue-50">
                      {state}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Action Types */}
              <div>
                <div className="text-sm font-medium text-text-primary mb-2">
                  Action Types ({detail.action_types.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.action_types.map((actionType) => (
                    <Badge
                      key={actionType}
                      variant="outline"
                      className="bg-green-50"
                    >
                      {actionType}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Screenshot Grid */}
              {detail.screenshots && detail.screenshots.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-text-primary mb-3">
                    Screenshots ({detail.screenshots.length})
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {detail.screenshots.slice(0, 6).map((screenshot, idx) => (
                      <div
                        key={idx}
                        className="border border-border-subtle rounded-lg overflow-hidden bg-surface-canvas"
                      >
                        <div className="aspect-video bg-surface-raised flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-text-muted" />
                        </div>
                        <div className="p-2">
                          <div className="text-xs text-text-muted truncate">
                            {screenshot.states.join(", ")}
                          </div>
                        </div>
                      </div>
                    ))}
                    {detail.screenshots.length > 6 && (
                      <div className="border border-border-subtle rounded-lg overflow-hidden bg-surface-raised flex items-center justify-center aspect-video">
                        <div className="text-center text-text-muted">
                          <div className="text-2xl font-bold">
                            +{detail.screenshots.length - 6}
                          </div>
                          <div className="text-xs">more</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tags */}
              {detail.tags && detail.tags.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-text-primary mb-2">
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {detail.notes && (
                <div>
                  <div className="text-sm font-medium text-text-primary mb-2">
                    Notes
                  </div>
                  <div className="text-sm text-text-secondary bg-surface-canvas p-3 rounded-lg border border-border-subtle">
                    {detail.notes}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
