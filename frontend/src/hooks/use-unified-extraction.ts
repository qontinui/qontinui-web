/**
 * Unified Extraction Hook
 *
 * React hook for using the unified extraction service with:
 * - Automatic status polling
 * - Progress tracking
 * - Session isolation
 * - Result caching
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type {
  UnifiedExtractionJob,
  UnifiedExtractionProgress,
  UnifiedExtractionRequest,
  UnifiedExtractionResult,
} from "@/types/unified-extraction";
import { unifiedExtractionService } from "@/services/unified-extraction-service";

// ============================================================================
// Types
// ============================================================================

export interface UseUnifiedExtractionOptions {
  /** Auto-poll interval in ms (default: 2000, set to 0 to disable) */
  pollInterval?: number;

  /** Custom session ID (defaults to auto-generated) */
  sessionId?: string;

  /** Callback when extraction completes */
  onComplete?: (result: UnifiedExtractionResult) => void;

  /** Callback when extraction fails */
  onError?: (error: Error) => void;

  /** Callback for progress updates */
  onProgress?: (progress: UnifiedExtractionProgress) => void;
}

export interface UseUnifiedExtractionReturn {
  // Session
  sessionId: string;

  // Current job state
  currentJob: UnifiedExtractionJob | null;
  isRunning: boolean;
  progress: UnifiedExtractionProgress | null;

  // Results
  result: UnifiedExtractionResult | null;
  error: Error | null;

  // Actions
  startExtraction: (request: UnifiedExtractionRequest) => Promise<void>;
  cancelExtraction: () => Promise<void>;
  clearResults: () => void;

  // Job list
  jobs: UnifiedExtractionJob[];
  isLoadingJobs: boolean;
  refreshJobs: () => void;

  // Convenience methods
  startVisionExtraction: (
    screenshot: string,
    options?: Partial<UnifiedExtractionRequest>
  ) => Promise<void>;
  startPlaywrightExtraction: (
    url: string,
    options?: Partial<UnifiedExtractionRequest>
  ) => Promise<void>;
  startPatternMatch: (
    screenshot: string,
    template: string,
    options?: Partial<UnifiedExtractionRequest>
  ) => Promise<void>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useUnifiedExtraction(
  options: UseUnifiedExtractionOptions = {}
): UseUnifiedExtractionReturn {
  const {
    pollInterval = 2000,
    sessionId: customSessionId,
    onComplete,
    onError,
    onProgress,
  } = options;

  // Session ID
  const sessionId = useMemo(
    () => customSessionId || unifiedExtractionService.getSessionId(),
    [customSessionId]
  );

  // State
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UnifiedExtractionProgress | null>(
    null
  );
  const [result, setResult] = useState<UnifiedExtractionResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Ref for unsubscribe function
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Set custom session ID if provided
  useEffect(() => {
    if (customSessionId) {
      unifiedExtractionService.setSessionId(customSessionId);
    }
  }, [customSessionId]);

  // ============================================================================
  // Job Status Query (with polling)
  // ============================================================================

  const { data: currentJob } = useQuery({
    queryKey: ["unified-extraction-job", currentJobId],
    queryFn: async () => {
      if (!currentJobId) return null;
      return unifiedExtractionService.getJobStatus(currentJobId);
    },
    enabled: !!currentJobId,
    refetchInterval:
      pollInterval > 0 && currentJobId
        ? (query) => {
            const status = query.state.data?.status;
            // Stop polling when job completes or fails
            if (status === "completed" || status === "failed") {
              return false;
            }
            return pollInterval;
          }
        : false,
  });

  // Handle job completion/failure
  useEffect(() => {
    if (!currentJob) return;

    if (currentJob.status === "completed") {
      // Fetch results
      unifiedExtractionService.getJobResults(currentJob.jobId).then((res) => {
        if (res) {
          setResult(res);
          onComplete?.(res);
        }
        setCurrentJobId(null);
      });
    } else if (currentJob.status === "failed") {
      const err = new Error(currentJob.error || "Extraction failed");
      setError(err);
      onError?.(err);
      setCurrentJobId(null);
    }
  }, [currentJob?.status, currentJob?.jobId, onComplete, onError]);

  // ============================================================================
  // Job List Query
  // ============================================================================

  const {
    data: jobs = [],
    isLoading: isLoadingJobs,
    refetch: refreshJobs,
  } = useQuery({
    queryKey: ["unified-extraction-jobs", sessionId],
    queryFn: () => unifiedExtractionService.listJobs(),
    refetchInterval: pollInterval > 0 ? pollInterval * 5 : false, // Less frequent for job list
  });

  // ============================================================================
  // Start Extraction Mutation
  // ============================================================================

  const startExtractionMutation = useMutation({
    mutationFn: async (request: UnifiedExtractionRequest) => {
      // Clear previous state
      setError(null);
      setResult(null);
      setProgress(null);

      // Subscribe to progress updates
      const jobId = `temp_${Date.now()}`;
      unsubscribeRef.current = unifiedExtractionService.onProgress(
        jobId,
        (p) => {
          setProgress(p);
          onProgress?.(p);
        }
      );

      // Start extraction
      const result = await unifiedExtractionService.startExtraction({
        ...request,
        sessionId,
      });

      // If completed synchronously (vision, pattern)
      if (result.status === "completed") {
        setResult(result);
        onComplete?.(result);
        return result;
      }

      // If failed
      if (result.status === "failed") {
        const err = new Error(result.error || "Extraction failed");
        setError(err);
        onError?.(err);
        throw err;
      }

      // If async (playwright, web), start polling
      setCurrentJobId(result.jobId);

      // Update progress subscription with actual job ID
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      unsubscribeRef.current = unifiedExtractionService.onProgress(
        result.jobId,
        (p) => {
          setProgress(p);
          onProgress?.(p);
        }
      );

      return result;
    },
    onError: (err: Error) => {
      setError(err);
      onError?.(err);
    },
  });

  // ============================================================================
  // Actions
  // ============================================================================

  const startExtraction = useCallback(
    async (request: UnifiedExtractionRequest) => {
      await startExtractionMutation.mutateAsync(request);
    },
    [startExtractionMutation]
  );

  const cancelExtraction = useCallback(async () => {
    if (currentJobId) {
      await unifiedExtractionService.cancelJob(currentJobId);
      setCurrentJobId(null);
      setProgress(null);
    }
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, [currentJobId]);

  const clearResults = useCallback(() => {
    setResult(null);
    setError(null);
    setProgress(null);
    setCurrentJobId(null);
  }, []);

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  const startVisionExtraction = useCallback(
    async (
      screenshot: string,
      opts: Partial<UnifiedExtractionRequest> = {}
    ) => {
      await startExtraction({
        method: "vision",
        screenshot,
        ...opts,
      });
    },
    [startExtraction]
  );

  const startPlaywrightExtraction = useCallback(
    async (url: string, opts: Partial<UnifiedExtractionRequest> = {}) => {
      await startExtraction({
        method: "playwright",
        url,
        ...opts,
      });
    },
    [startExtraction]
  );

  const startPatternMatch = useCallback(
    async (
      screenshot: string,
      template: string,
      opts: Partial<UnifiedExtractionRequest> = {}
    ) => {
      await startExtraction({
        method: "pattern",
        screenshot,
        template,
        ...opts,
      });
    },
    [startExtraction]
  );

  // ============================================================================
  // Cleanup
  // ============================================================================

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  // ============================================================================
  // Return Value
  // ============================================================================

  const isRunning =
    startExtractionMutation.isPending ||
    currentJob?.status === "running" ||
    currentJob?.status === "pending";

  return {
    // Session
    sessionId,

    // Current job state
    currentJob: currentJob || null,
    isRunning,
    progress,

    // Results
    result,
    error,

    // Actions
    startExtraction,
    cancelExtraction,
    clearResults,

    // Job list
    jobs,
    isLoadingJobs,
    refreshJobs: () => refreshJobs(),

    // Convenience methods
    startVisionExtraction,
    startPlaywrightExtraction,
    startPatternMatch,
  };
}

// ============================================================================
// Specialized Hooks
// ============================================================================

/**
 * Hook specifically for pattern matching operations.
 */
export function usePatternMatching(
  options: Omit<UseUnifiedExtractionOptions, "pollInterval"> = {}
) {
  const extraction = useUnifiedExtraction({
    ...options,
    pollInterval: 0, // Pattern matching is synchronous
  });

  return {
    ...extraction,
    findPattern: extraction.startPatternMatch,
    matches: extraction.result?.elements || [],
    searchTimeMs: extraction.result?.durationMs,
  };
}

/**
 * Hook specifically for vision extraction operations.
 */
export function useVisionExtraction(
  options: Omit<UseUnifiedExtractionOptions, "pollInterval"> = {}
) {
  const extraction = useUnifiedExtraction({
    ...options,
    pollInterval: 0, // Vision extraction is synchronous
  });

  return {
    ...extraction,
    extract: extraction.startVisionExtraction,
    elements: extraction.result?.elements || [],
    overlays: extraction.result?.overlays,
    processingTimeMs: extraction.result?.durationMs,
  };
}

/**
 * Hook specifically for Playwright extraction operations.
 */
export function usePlaywrightExtraction(
  options: UseUnifiedExtractionOptions = {}
) {
  const extraction = useUnifiedExtraction(options);

  return {
    ...extraction,
    startCollection: extraction.startPlaywrightExtraction,
    clickables: extraction.result?.elements || [],
    metrics: extraction.result?.metrics,
  };
}
