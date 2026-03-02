import { useState, useCallback } from "react";
import { toast } from "sonner";
import type {
  TemplateCaptureService,
  CandidateBoundingBox,
  TemplateCandidate,
} from "@/services/template-capture-service";

interface UseCandidateActionsParams {
  service: TemplateCaptureService;
  setCandidates: React.Dispatch<React.SetStateAction<TemplateCandidate[]>>;
  onCandidateApproved?: (id: string) => void;
  onCandidateRejected?: (id: string) => void;
}

export function useCandidateActions({
  service,
  setCandidates,
  onCandidateApproved,
  onCandidateRejected,
}: UseCandidateActionsParams) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

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
    [service, setCandidates, onCandidateApproved]
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
    [service, setCandidates, onCandidateRejected]
  );

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
    [service, setCandidates]
  );

  const handleBulkApprove = useCallback(
    async (selectedIds: Set<string>, clearSelection: () => void) => {
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
        description:
          successCount < ids.length
            ? `${ids.length - successCount} failed`
            : "All templates approved successfully",
      });
    },
    [handleApprove]
  );

  const handleBulkReject = useCallback(
    async (selectedIds: Set<string>, clearSelection: () => void) => {
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
    },
    [handleReject]
  );

  return {
    processingIds,
    bulkProgress,
    handleApprove,
    handleReject,
    handleDelete,
    handleBulkApprove,
    handleBulkReject,
  };
}
