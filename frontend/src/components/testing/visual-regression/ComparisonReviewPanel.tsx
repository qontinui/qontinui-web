"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  Eye,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
// Define missing types locally since they're not exported from testing-service
interface VisualComparisonResult {
  id: string;
  status: string;
  state_name: string;
  similarity_score: number;
  threshold_used: number;
  diff_region_count: number;
  screenshot_url?: string;
  baseline_url?: string;
  diff_image_url?: string;
  diff_regions?: unknown[];
  error_message?: string;
}

type ReviewDecision = "approved" | "rejected" | "new_baseline";

import { VisualDiffViewer } from "./VisualDiffViewer";
import type { DiffRegion } from "@/services/testing-service";

interface ComparisonReviewPanelProps {
  comparisons: VisualComparisonResult[];
  onReview: (
    comparisonId: string,
    decision: ReviewDecision,
    notes?: string
  ) => Promise<void>;
  onViewDetails?: (comparison: VisualComparisonResult) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * ComparisonReviewPanel - Review pending visual comparisons
 *
 * Features:
 * - List of pending reviews with thumbnails
 * - Quick approve/reject/new baseline actions
 * - Detailed diff viewer modal
 * - Notes input for decisions
 * - Batch operations
 */
export function ComparisonReviewPanel({
  comparisons,
  onReview,
  onViewDetails: _onViewDetails,
  isLoading = false,
  className,
}: ComparisonReviewPanelProps) {
  void _onViewDetails; // Reserved for future use
  const [selectedComparison, setSelectedComparison] =
    useState<VisualComparisonResult | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  const handleReview = async (
    comparison: VisualComparisonResult,
    decision: ReviewDecision
  ) => {
    setSubmitting(comparison.id);
    try {
      await onReview(comparison.id, decision, reviewNotes || undefined);
      setReviewNotes("");
      setSelectedComparison(null);
    } finally {
      setSubmitting(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "passed":
        return "bg-green-500/10 text-green-700 border-green-500/20";
      case "failed":
        return "bg-red-500/10 text-red-700 border-red-500/20";
      case "pending_review":
        return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
      case "approved_as_new":
        return "bg-blue-500/10 text-blue-700 border-blue-500/20";
      case "no_baseline":
        return "bg-gray-500/10 text-gray-700 border-gray-500/20";
      default:
        return "";
    }
  };

  if (comparisons.length === 0) {
    return (
      <div className={cn("text-center py-12", className)}>
        <Check className="h-12 w-12 mx-auto text-green-500 mb-4" />
        <h3 className="text-lg font-medium">All caught up!</h3>
        <p className="text-muted-foreground">No comparisons pending review</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">
          Pending Reviews ({comparisons.length})
        </h3>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {/* Comparison List */}
      <div className="space-y-3">
        {comparisons.map((comparison) => (
          <Card key={comparison.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                {/* Thumbnail */}
                <div
                  role="button"
                  tabIndex={0}
                  className="flex-shrink-0 w-32 h-24 rounded-lg border bg-muted cursor-pointer overflow-hidden relative group"
                  onClick={() => setSelectedComparison(comparison)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                >
                  {comparison.screenshot_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={comparison.screenshot_url}
                      alt="Screenshot"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                      No image
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye className="h-6 w-6 text-white" />
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-medium truncate">
                        {comparison.state_name}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Similarity:{" "}
                        {(comparison.similarity_score * 100).toFixed(1)}%
                        <span className="mx-2">|</span>
                        Threshold:{" "}
                        {(comparison.threshold_used * 100).toFixed(0)}%
                      </p>
                    </div>
                    <Badge className={getStatusColor(comparison.status)}>
                      {comparison.status.replace(/_/g, " ")}
                    </Badge>
                  </div>

                  {comparison.diff_region_count > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      <AlertTriangle className="h-3 w-3 inline mr-1" />
                      {comparison.diff_region_count} diff region
                      {comparison.diff_region_count > 1 ? "s" : ""} detected
                    </p>
                  )}

                  {comparison.error_message && (
                    <p className="text-sm text-red-600 mt-1 truncate">
                      {comparison.error_message}
                    </p>
                  )}

                  {/* Quick Actions */}
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={() => handleReview(comparison, "approved")}
                      disabled={submitting === comparison.id}
                    >
                      {submitting === comparison.id ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-1" />
                      )}
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleReview(comparison, "rejected")}
                      disabled={submitting === comparison.id}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      onClick={() => handleReview(comparison, "new_baseline")}
                      disabled={submitting === comparison.id}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      New Baseline
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedComparison(comparison)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Diff
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detail Dialog */}
      <Dialog
        open={selectedComparison !== null}
        onOpenChange={() => setSelectedComparison(null)}
      >
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          {selectedComparison && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Review: {selectedComparison.state_name}
                </DialogTitle>
                <DialogDescription>
                  Compare the screenshot against the baseline and make a
                  decision.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4">
                <VisualDiffViewer
                  baselineUrl={selectedComparison.baseline_url ?? null}
                  screenshotUrl={selectedComparison.screenshot_url ?? null}
                  diffUrl={selectedComparison.diff_image_url ?? null}
                  diffRegions={
                    (selectedComparison.diff_regions ?? []) as DiffRegion[]
                  }
                  similarityScore={selectedComparison.similarity_score}
                  threshold={selectedComparison.threshold_used}
                />
              </div>

              {/* Notes input */}
              <div className="space-y-2">
                <label htmlFor="crp-notes" className="text-sm font-medium">
                  Review Notes (optional)
                </label>
                <Textarea
                  id="crp-notes"
                  placeholder="Add notes about your decision..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={2}
                />
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedComparison(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                  onClick={() => handleReview(selectedComparison, "approved")}
                  disabled={submitting === selectedComparison.id}
                >
                  {submitting === selectedComparison.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-1" />
                  )}
                  Approve (Acceptable)
                </Button>
                <Button
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => handleReview(selectedComparison, "rejected")}
                  disabled={submitting === selectedComparison.id}
                >
                  <X className="h-4 w-4 mr-1" />
                  Reject (Bug)
                </Button>
                <Button
                  variant="default"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() =>
                    handleReview(selectedComparison, "new_baseline")
                  }
                  disabled={submitting === selectedComparison.id}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Set as New Baseline
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ComparisonReviewPanel;
