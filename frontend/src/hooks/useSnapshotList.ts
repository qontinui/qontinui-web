// hooks/useSnapshotList.ts

import { useState, useEffect } from 'react';
import { listSnapshots } from '@/lib/api/snapshots';
import type { SnapshotRun } from '@/types/snapshots';

interface UseSnapshotListParams {
  limit?: number;
  workflow_id?: number;
  tags?: string;
  autoLoad?: boolean;
}

export function useSnapshotList(params?: UseSnapshotListParams) {
  const [snapshots, setSnapshots] = useState<SnapshotRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);

  const loadSnapshots = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await listSnapshots({
        limit: params?.limit || 50,
        workflow_id: params?.workflow_id,
        tags: params?.tags,
      });

      setSnapshots(response.snapshots);
      setTotal(response.total);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params?.autoLoad !== false) {
      loadSnapshots();
    }
  }, [params?.limit, params?.workflow_id, params?.tags]);

  return {
    snapshots,
    loading,
    error,
    total,
    reload: loadSnapshots,
  };
}
