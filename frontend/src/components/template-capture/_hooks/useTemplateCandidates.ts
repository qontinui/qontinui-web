import { useState, useCallback, useEffect, useMemo } from "react";
import {
  TemplateCaptureService,
  type CandidateListResponse,
  type CandidateStatus,
  type TemplateCandidate,
} from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";

export type FilterStatus = CandidateStatus | "all";

interface UseTemplateCandidatesParams {
  sessionId?: string;
  projectId?: string;
}

export function useTemplateCandidates({
  sessionId,
  projectId,
}: UseTemplateCandidatesParams) {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [candidates, setCandidates] = useState<TemplateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

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
      setError(
        err instanceof Error ? err.message : "Failed to load candidates"
      );
      console.error("[TemplateReviewPanel] Error fetching candidates:", err);
    } finally {
      setLoading(false);
    }
  }, [service, sessionId, projectId, filterStatus]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const stats = useMemo(
    () => ({
      total: candidates.length,
      pending: candidates.filter((c) => c.status === "pending").length,
      approved: candidates.filter(
        (c) => c.status === "approved" || c.status === "modified"
      ).length,
      rejected: candidates.filter((c) => c.status === "rejected").length,
    }),
    [candidates]
  );

  const uniqueStateHints = useMemo(() => {
    return service.getUniqueStateHints(candidates);
  }, [service, candidates]);

  return {
    service,
    candidates,
    setCandidates,
    loading,
    error,
    filterStatus,
    setFilterStatus,
    fetchCandidates,
    stats,
    uniqueStateHints,
  };
}
