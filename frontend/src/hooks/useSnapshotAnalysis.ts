// hooks/useSnapshotAnalysis.ts

import { useState, useEffect } from 'react';
import type { SnapshotAnalysis, SnapshotDetail } from '@/types/snapshot-recommendations';

interface UseSnapshotAnalysisParams {
  snapshotId?: number;
  autoFetch?: boolean;
}

export function useSnapshotAnalysis(params?: UseSnapshotAnalysisParams) {
  const [analysis, setAnalysis] = useState<SnapshotAnalysis | null>(null);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAnalysis = async (snapshotId: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/snapshots/${snapshotId}/analysis`);

      if (!response.ok) {
        throw new Error('Failed to fetch snapshot analysis');
      }

      const data: SnapshotAnalysis = await response.json();
      setAnalysis(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (snapshotId: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/snapshots/${snapshotId}/detail`);

      if (!response.ok) {
        throw new Error('Failed to fetch snapshot detail');
      }

      const data: SnapshotDetail = await response.json();
      setDetail(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params?.autoFetch && params?.snapshotId) {
      fetchAnalysis(params.snapshotId);
    }
  }, [params?.snapshotId, params?.autoFetch]);

  return {
    analysis,
    detail,
    loading,
    error,
    fetchAnalysis,
    fetchDetail,
  };
}
