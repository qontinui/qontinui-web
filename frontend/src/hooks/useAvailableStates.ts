/**
 * Hook to fetch available states from all snapshot runs
 *
 * This hook aggregates unique states across all snapshots for filtering purposes.
 */

import { useState, useEffect } from 'react';
import { useSnapshotList } from './useSnapshotList';

interface UseAvailableStatesResult {
  availableStates: string[];
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches all unique states from all snapshot runs
 *
 * @returns Object containing available states array, loading state, and error
 */
export function useAvailableStates(): UseAvailableStatesResult {
  const { snapshots, loading: snapshotsLoading } = useSnapshotList();
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchStates = async () => {
      if (snapshotsLoading || snapshots.length === 0) {
        setAvailableStates([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const stateSet = new Set<string>();

        // Fetch screenshots from each snapshot to get their active states
        for (const snapshot of snapshots) {
          try {
            const response = await fetch(
              `/api/integration-testing/snapshots/${snapshot.run_id}/screenshots`
            );

            if (!response.ok) {
              console.warn(`Failed to load screenshots for snapshot ${snapshot.run_id}`);
              continue;
            }

            const data = await response.json();

            // Extract unique states from all screenshots
            data.screenshots?.forEach((screenshot: any) => {
              screenshot.active_states?.forEach((state: string) => {
                stateSet.add(state);
              });
            });
          } catch (err) {
            console.warn(`Error fetching screenshots for snapshot ${snapshot.run_id}:`, err);
            // Continue with other snapshots
          }
        }

        // Convert set to sorted array
        const states = Array.from(stateSet).sort();
        setAvailableStates(states);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch available states');
        setError(error);
        console.error('Error fetching available states:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStates();
  }, [snapshots, snapshotsLoading]);

  return {
    availableStates,
    loading: snapshotsLoading || loading,
    error,
  };
}
