/**
 * Hook for fetching start screenshot and initial states from a snapshot run
 */

import { useState, useEffect } from 'react';

export interface StartScreenshot {
  runId: string;
  screenshotPath: string | null;
  screenshotUrl: string | null;
  initialStates: string[];
  timestamp: string | null;
  found: boolean;
}

export interface UseStartScreenshotResult {
  startScreenshot: StartScreenshot | null;
  loading: boolean;
  error: Error | null;
}

export function useStartScreenshot(runId: string | null): UseStartScreenshotResult {
  const [startScreenshot, setStartScreenshot] = useState<StartScreenshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!runId) {
      setStartScreenshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchStartScreenshot = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/integration-testing/snapshots/${runId}/start-screenshot`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch start screenshot: ${response.statusText}`);
        }

        const data = await response.json();
        setStartScreenshot({
          runId: data.run_id,
          screenshotPath: data.screenshot_path,
          screenshotUrl: data.screenshot_url,
          initialStates: data.initial_states || [],
          timestamp: data.timestamp,
          found: data.found,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setStartScreenshot(null);
      } finally {
        setLoading(false);
      }
    };

    fetchStartScreenshot();
  }, [runId]);

  return { startScreenshot, loading, error };
}
