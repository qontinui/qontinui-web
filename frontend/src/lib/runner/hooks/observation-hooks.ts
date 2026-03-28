"use client";

import { useRunnerQuery, runnerFetch } from "../api-client";

// =============================================================================
// Types
// =============================================================================

export interface ObservationSearchResult {
  id: number;
  title: string;
  contentPreview: string;
  observationType: string;
  scope: string;
  topicKey?: string;
  revisionCount: number;
  projectId?: string;
  validFrom: string;
  validUntil?: string;
  supersededBy?: number;
  createdAt: string;
  updatedAt: string;
  rank?: number;
}

export interface Observation extends ObservationSearchResult {
  content: string;
  contentHash: string;
  duplicateCount: number;
  workflowId?: string;
  taskRunId?: string;
  sessionId?: string;
  isDeleted: boolean;
}

export interface ObservationHistoryEntry {
  id: number;
  observationId: number;
  title: string;
  contentPreview: string;
  contentHash: string;
  validFrom: string;
  validUntil: string;
  revisionNumber: number;
  createdAt: string;
}

export interface WeeklyTrend {
  observationType: string;
  weekStart: string;
  count: number;
}

export interface TopicRevisionCount {
  topicKey?: string;
  title: string;
  revisions: number;
}

export interface ObservationTypeStat {
  observationType: string;
  count: number;
  latestUpdated: string;
}

// =============================================================================
// Hooks
// =============================================================================

/** Search observations with optional temporal filtering. */
export function useObservationTemporalSearch(params: {
  q?: string;
  from?: string;
  to?: string;
  asOf?: string;
  maxResults?: number;
  enabled?: boolean;
}) {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  if (params.asOf) searchParams.set("as_of", params.asOf);
  if (params.maxResults != null) searchParams.set("max_results", String(params.maxResults));

  const qs = searchParams.toString();
  const path = `/observations/temporal-search${qs ? `?${qs}` : ""}`;

  return useRunnerQuery<ObservationSearchResult[]>(path, {
    enabled: params.enabled !== false,
  });
}

/** Full-text search over observations (non-temporal, legacy). */
export function useObservationSearch(q: string, projectId?: string) {
  const searchParams = new URLSearchParams({ q });
  if (projectId) searchParams.set("project_id", projectId);

  return useRunnerQuery<ObservationSearchResult[]>(
    q ? `/observations/search?${searchParams}` : null,
    { enabled: q.length > 0 }
  );
}

/** Get a single observation by ID. */
export function useObservation(id: number | null) {
  return useRunnerQuery<Observation>(
    id != null ? `/observations/${id}` : null,
    { enabled: id != null }
  );
}

/** Get revision history for an observation. */
export function useObservationHistory(id: number | null) {
  return useRunnerQuery<ObservationHistoryEntry[]>(
    id != null ? `/observations/${id}/history` : null,
    { enabled: id != null }
  );
}

/** Get weekly observation trends. */
export function useObservationTrends(weeks = 8) {
  return useRunnerQuery<WeeklyTrend[]>(
    `/observations/trends?weeks=${weeks}`,
    { pollInterval: 60000 }
  );
}

/** Get most revised topics in a date range. */
export function useMostRevisedTopics(from: string, to: string, maxResults = 20) {
  return useRunnerQuery<TopicRevisionCount[]>(
    `/observations/most-revised?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&max_results=${maxResults}`
  );
}

/** Get observation type statistics. */
export function useObservationStats() {
  return useRunnerQuery<ObservationTypeStat[]>("/observations/stats", {
    pollInterval: 30000,
  });
}

/** Point-in-time snapshot of observations as they were at `asOf`. */
export function useObservationSnapshot(asOf: string | null, maxResults = 100) {
  const path = asOf
    ? `/observations/snapshot?as_of=${encodeURIComponent(asOf)}&max_results=${maxResults}`
    : null;
  return useRunnerQuery<Observation[]>(path, {
    enabled: asOf != null,
  });
}

// =============================================================================
// Mutations
// =============================================================================

/** Mark an observation as superseded by another. */
export async function supersedeObservation(
  id: number,
  newObservationId: number
): Promise<{ superseded: boolean }> {
  return runnerFetch(`/observations/${id}/supersede`, {
    method: "POST",
    body: JSON.stringify({ new_observation_id: newObservationId }),
  });
}
