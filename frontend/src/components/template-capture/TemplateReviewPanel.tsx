/**
 * TemplateReviewPanel Component
 *
 * Grid view of template candidates with filtering, bulk actions, and review workflow.
 *
 * Features:
 * - Grid view with thumbnails showing detected boundaries
 * - Confidence score indicator (color-coded)
 * - Quick approve/reject buttons
 * - Bulk select and bulk operations
 * - Filter by status (pending, approved, rejected)
 * - Click to open BoundaryAdjustmentEditor
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Check,
  Filter,
  RefreshCw,
  CheckSquare,
  Square,
  Loader2,
  GitBranch,
  Tag,
  MousePointerClick,
  Inbox,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TemplateCandidateCard } from "./TemplateCandidateCard";
import { BoundaryAdjustmentEditor } from "./BoundaryAdjustmentEditor";
import { ImportToStateMachineDialog } from "./ImportToStateMachineDialog";
import { GenerateStateMachineDialog } from "./GenerateStateMachineDialog";
import { SetStateHintDialog } from "./SetStateHintDialog";
import type {
  TemplateCandidate,
  CandidateStatus,
  CandidateBoundingBox,
} from "@/services/template-capture-service";
import {
  TemplateCaptureService,
  CandidateListResponse,
} from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";

export interface TemplateReviewPanelProps {
  sessionId?: string;
  projectId?: string;
  videoPath?: string;
  onCandidateApproved?: (id: string) => void;
  onCandidateRejected?: (id: string) => void;
  onCandidateImported?: (id: string, stateId: string) => void;
  onStateMachineGenerated?: (config: unknown) => void;
  className?: string;
}

type FilterStatus = CandidateStatus | "all";

export function TemplateReviewPanel({
  sessionId,
  projectId,
  videoPath,
  onCandidateApproved,
  onCandidateRejected,
  onCandidateImported,
  onStateMachineGenerated,
  className,
}: TemplateReviewPanelProps) {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [candidates, setCandidates] = useState<TemplateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCandidate, setEditingCandidate] =
    useState<TemplateCandidate | null>(null);
  const [importingCandidate, setImportingCandidate] =
    useState<TemplateCandidate | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [settingHintCandidates, setSettingHintCandidates] = useState<
    TemplateCandidate[]
  >([]);

  // Fetch candidates
  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: {
        session_id?: string;
        project_id?: string;
        status?: CandidateStatus;
        limit: number;
      } = {
        limit: 100,
      };

      if (sessionId) params.session_id = sessionId;
      if (projectId) params.project_id = projectId;
      if (filterStatus !== "all") params.status = filterStatus;

      const response: CandidateListResponse =
        await service.listCandidates(params);
      setCandidates(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidates");
      console.error("[TemplateReviewPanel] Error fetching candidates:", err);
    } finally {
      setLoading(false);
    }
  }, [service, sessionId, projectId, filterStatus]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const pendingIds = candidates
      .filter((c) => c.status === "pending")
      .map((c) => c.id);
    setSelectedIds(new Set(pendingIds));
  }, [candidates]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Action handlers
  const handleApprove = useCallback(
    async (id: string, adjustedBoundary?: CandidateBoundingBox) => {
      setProcessingIds((prev) => new Set(prev).add(id));
      try {
        await service.approveCandidate(
          id,
          adjustedBoundary ? { adjusted_boundary: adjustedBoundary } : undefined
        );
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: adjustedBoundary ? "modified" : "approved",
                  adjusted_boundary: adjustedBoundary,
                }
              : c
          )
        );
        onCandidateApproved?.(id);
      } catch (err) {
        console.error("[TemplateReviewPanel] Error approving candidate:", err);
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [service, onCandidateApproved]
  );

  const handleReject = useCallback(
    async (id: string) => {
      setProcessingIds((prev) => new Set(prev).add(id));
      try {
        await service.rejectCandidate(id);
        setCandidates((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "rejected" } : c))
        );
        onCandidateRejected?.(id);
      } catch (err) {
        console.error("[TemplateReviewPanel] Error rejecting candidate:", err);
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [service, onCandidateRejected]
  );

  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  const handleBulkApprove = useCallback(async () => {
    const ids = Array.from(selectedIds);
    setBulkProgress({ current: 0, total: ids.length });

    let successCount = 0;
    for (const [i, id] of ids.entries()) {
      setBulkProgress({ current: i + 1, total: ids.length });
      try {
        await handleApprove(id);
        successCount++;
      } catch (err) {
        console.error(`Failed to approve ${id}:`, err);
      }
    }

    setBulkProgress(null);
    clearSelection();

    toast.success(`Approved ${successCount} templates`, {
      description: successCount < ids.length
        ? `${ids.length - successCount} failed`
        : "All templates approved successfully",
    });
  }, [selectedIds, handleApprove, clearSelection]);

  const handleBulkReject = useCallback(async () => {
    const ids = Array.from(selectedIds);
    setBulkProgress({ current: 0, total: ids.length });

    let successCount = 0;
    for (const [i, id] of ids.entries()) {
      setBulkProgress({ current: i + 1, total: ids.length });
      try {
        await handleReject(id);
        successCount++;
      } catch (err) {
        console.error(`Failed to reject ${id}:`, err);
      }
    }

    setBulkProgress(null);
    clearSelection();

    toast.info(`Rejected ${successCount} templates`);
  }, [selectedIds, handleReject, clearSelection]);

  const handleDelete = useCallback(
    async (id: string) => {
      setProcessingIds((prev) => new Set(prev).add(id));
      try {
        await service.deleteCandidate(id);
        setCandidates((prev) => prev.filter((c) => c.id !== id));
      } catch (err) {
        console.error("[TemplateReviewPanel] Error deleting candidate:", err);
      } finally {
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [service]
  );

  const handleImportComplete = useCallback(
    (stateId: string) => {
      if (importingCandidate) {
        onCandidateImported?.(importingCandidate.id, stateId);
        setImportingCandidate(null);
      }
    },
    [importingCandidate, onCandidateImported]
  );

  // Stats
  const stats = {
    total: candidates.length,
    pending: candidates.filter((c) => c.status === "pending").length,
    approved: candidates.filter(
      (c) => c.status === "approved" || c.status === "modified"
    ).length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
  };

  // Get unique state hints
  const uniqueStateHints = useMemo(() => {
    return service.getUniqueStateHints(candidates);
  }, [service, candidates]);

  // Handle state hint saved
  const handleStateHintSaved = useCallback(
    (hint: string) => {
      // Update local state to reflect the change
      const updatedIds = new Set(settingHintCandidates.map((c) => c.id));
      setCandidates((prev) =>
        prev.map((c) =>
          updatedIds.has(c.id)
            ? {
                ...c,
                user_metadata: { ...c.user_metadata, state_hint: hint },
              }
            : c
        )
      );
      setSettingHintCandidates([]);
      clearSelection();
    },
    [settingHintCandidates, clearSelection]
  );

  // Handle set state hint for selected
  const handleSetStateHintForSelected = useCallback(() => {
    const selected = candidates.filter((c) => selectedIds.has(c.id));
    setSettingHintCandidates(selected);
  }, [candidates, selectedIds]);

  // Handle state machine generated
  const handleStateMachineGenerated = useCallback(
    (result: unknown) => {
      onStateMachineGenerated?.(result);
      setShowGenerateDialog(false);
    },
    [onStateMachineGenerated]
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Template Candidates</h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{stats.total} total</Badge>
            <Badge variant="secondary" className="text-yellow-600">
              {stats.pending} pending
            </Badge>
            <Badge variant="secondary" className="text-green-600">
              {stats.approved} approved
            </Badge>
            <Badge variant="secondary" className="text-red-600">
              {stats.rejected} rejected
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as FilterStatus)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="modified">Modified</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCandidates}
            disabled={loading}
          >
            <RefreshCw
              className={cn("h-4 w-4 mr-2", loading && "animate-spin")}
            />
            Refresh
          </Button>

          {/* Generate State Machine */}
          {stats.approved > 0 && (
            <Button
              size="sm"
              onClick={() => setShowGenerateDialog(true)}
            >
              <GitBranch className="h-4 w-4 mr-2" />
              Generate State Machine
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {stats.pending > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectedIds.size > 0 ? clearSelection : selectAll}
            >
              {selectedIds.size > 0 ? (
                <CheckSquare className="h-4 w-4 mr-2" />
              ) : (
                <Square className="h-4 w-4 mr-2" />
              )}
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : "Select all pending"}
            </Button>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                onClick={handleBulkApprove}
                disabled={!!bulkProgress}
              >
                {bulkProgress ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Approve {selectedIds.size}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={handleBulkReject}
                disabled={!!bulkProgress}
              >
                {bulkProgress ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                Reject {selectedIds.size}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetStateHintForSelected}
                disabled={!!bulkProgress}
              >
                <Tag className="h-4 w-4 mr-2" />
                Set State Hint
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Bulk Progress Overlay */}
        {bulkProgress && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-card p-6 rounded-lg shadow-lg border text-center space-y-4">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <div>
                <p className="font-medium">Processing templates...</p>
                <p className="text-sm text-muted-foreground">
                  {bulkProgress.current} of {bulkProgress.total}
                </p>
              </div>
              <div className="w-48 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {loading && candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading candidates...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <div className="p-4 rounded-full bg-red-100 dark:bg-red-950">
              <XCircle className="h-10 w-10 text-red-500" />
            </div>
            <div>
              <p className="font-medium text-red-600 mb-1">Failed to load candidates</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" onClick={fetchCandidates}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <div className="p-4 rounded-full bg-muted">
              <Inbox className="h-10 w-10 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-muted-foreground mb-1">No candidates found</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Start a capture session to automatically detect UI elements.
                Go to the Capture tab and click on buttons and elements in your target application.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MousePointerClick className="h-4 w-4" />
              <span>Click elements during capture to generate templates</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="relative">
                {/* Selection Checkbox */}
                {candidate.status === "pending" && (
                  <button
                    className={cn(
                      "absolute -top-2 -left-2 z-20 h-6 w-6 rounded-full",
                      "flex items-center justify-center",
                      "border-2 bg-background shadow-sm",
                      "transition-colors",
                      selectedIds.has(candidate.id)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30 hover:border-primary/50"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(candidate.id);
                    }}
                  >
                    {selectedIds.has(candidate.id) && (
                      <Check className="h-3 w-3" />
                    )}
                  </button>
                )}

                {/* Processing Overlay */}
                {processingIds.has(candidate.id) && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 rounded-lg">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}

                <TemplateCandidateCard
                  candidate={candidate}
                  isSelected={selectedIds.has(candidate.id)}
                  onSelect={() => {
                    if (candidate.status === "approved" || candidate.status === "modified") {
                      setImportingCandidate(candidate);
                    } else if (candidate.status === "pending") {
                      setEditingCandidate(candidate);
                    }
                  }}
                  onApprove={() => handleApprove(candidate.id)}
                  onReject={() => handleReject(candidate.id)}
                  onEdit={() => setEditingCandidate(candidate)}
                  onDelete={() => handleDelete(candidate.id)}
                  thumbnailUrl={service.getThumbnailUrl(candidate)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Boundary Adjustment Editor Dialog */}
      {editingCandidate && (
        <BoundaryAdjustmentEditor
          candidate={editingCandidate}
          imageUrl={service.getImageUrl(editingCandidate)}
          onSave={(adjustedBoundary) => {
            handleApprove(editingCandidate.id, adjustedBoundary);
            setEditingCandidate(null);
          }}
          onCancel={() => setEditingCandidate(null)}
        />
      )}

      {/* Import to State Machine Dialog */}
      {importingCandidate && (
        <ImportToStateMachineDialog
          candidate={importingCandidate}
          onImport={handleImportComplete}
          onClose={() => setImportingCandidate(null)}
        />
      )}

      {/* Generate State Machine Dialog */}
      {showGenerateDialog && (
        <GenerateStateMachineDialog
          projectId={projectId}
          sessionId={sessionId}
          videoPath={videoPath}
          onGenerate={handleStateMachineGenerated}
          onClose={() => setShowGenerateDialog(false)}
        />
      )}

      {/* Set State Hint Dialog */}
      {settingHintCandidates.length > 0 && (
        <SetStateHintDialog
          candidates={settingHintCandidates}
          existingHints={uniqueStateHints}
          onSave={handleStateHintSaved}
          onClose={() => setSettingHintCandidates([])}
        />
      )}
    </div>
  );
}
