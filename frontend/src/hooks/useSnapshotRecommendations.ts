// hooks/useSnapshotRecommendations.ts

import { useState, useEffect } from 'react';
import type {
  RecommendationRequest,
  RecommendationResponse,
  SnapshotRecommendation,
} from '@/types/snapshot-recommendations';

interface UseSnapshotRecommendationsParams extends RecommendationRequest {
  autoFetch?: boolean;
}

export function useSnapshotRecommendations(params?: UseSnapshotRecommendationsParams) {
  const [recommendations, setRecommendations] = useState<SnapshotRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<SnapshotRecommendation | null>(null);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);

    try {
      // Build query parameters
      const searchParams = new URLSearchParams();
      if (params?.process_id) searchParams.set('process_id', params.process_id);
      if (params?.max_snapshots) searchParams.set('max_snapshots', params.max_snapshots.toString());
      if (params?.num_recommendations) searchParams.set('num_recommendations', params.num_recommendations.toString());

      const response = await fetch(`/api/snapshots/recommendations?${searchParams}`);

      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data: RecommendationResponse = await response.json();
      setRecommendations(data.recommendations);

      // Auto-select the first (best) recommendation
      if (data.recommendations.length > 0) {
        setSelectedRecommendation(data.recommendations[0]);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params?.autoFetch !== false && params?.process_id) {
      fetchRecommendations();
    }
  }, [params?.process_id, params?.max_snapshots, params?.num_recommendations]);

  return {
    recommendations,
    selectedRecommendation,
    setSelectedRecommendation,
    loading,
    error,
    refetch: fetchRecommendations,
  };
}
