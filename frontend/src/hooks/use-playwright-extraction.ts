"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { playwrightExtractionService } from "@/services/playwright-extraction-service";
import type {
  PlaywrightExtractionJob,
  PlaywrightExtractionRequest,
} from "@/types/extraction";

/**
 * Hook to start and monitor a Playwright extraction job.
 */
export function usePlaywrightExtraction() {
  const queryClient = useQueryClient();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Query for current job status
  const {
    data: currentJob,
    isLoading: isLoadingJob,
    error: jobError,
    refetch: refetchJob,
  } = useQuery<PlaywrightExtractionJob | null>({
    queryKey: ["playwright-extraction", currentJobId],
    queryFn: () =>
      currentJobId
        ? playwrightExtractionService.getJobStatus(currentJobId)
        : null,
    enabled: !!currentJobId,
    refetchInterval: isPolling ? 2000 : false,
  });

  // Stop polling when job completes or fails
  useEffect(() => {
    if (
      currentJob &&
      (currentJob.status === "completed" || currentJob.status === "failed")
    ) {
      setIsPolling(false);
    }
  }, [currentJob?.status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Mutation to start extraction
  const startExtractionMutation = useMutation({
    mutationFn: (request: Partial<PlaywrightExtractionRequest>) =>
      playwrightExtractionService.startExtraction(request),
    onSuccess: (job) => {
      setCurrentJobId(job.job_id);
      setIsPolling(true);
      queryClient.invalidateQueries({ queryKey: ["playwright-jobs"] });
    },
  });

  // Mutation to start single-page extraction
  const startSinglePageMutation = useMutation({
    mutationFn: (params: {
      url: string;
      maxElements?: number;
      verifyExtractions?: boolean;
      verificationThreshold?: number;
      additionalBlockedKeywords?: string[];
    }) =>
      playwrightExtractionService.startSinglePageExtraction(params.url, {
        maxElements: params.maxElements,
        verifyExtractions: params.verifyExtractions,
        verificationThreshold: params.verificationThreshold,
        additionalBlockedKeywords: params.additionalBlockedKeywords,
      }),
    onSuccess: (job) => {
      setCurrentJobId(job.job_id);
      setIsPolling(true);
      queryClient.invalidateQueries({ queryKey: ["playwright-jobs"] });
    },
  });

  // Mutation to build states from extraction
  const buildStatesMutation = useMutation({
    mutationFn: (params: {
      jobId: string;
      stateNamePrefix?: string;
      verifiedOnly?: boolean;
      minConfidence?: number;
    }) =>
      playwrightExtractionService.buildStates(params.jobId, {
        stateNamePrefix: params.stateNamePrefix,
        verifiedOnly: params.verifiedOnly,
        minConfidence: params.minConfidence,
      }),
  });

  // Mutation to delete job
  const deleteJobMutation = useMutation({
    mutationFn: (jobId: string) => playwrightExtractionService.deleteJob(jobId),
    onSuccess: () => {
      setCurrentJobId(null);
      queryClient.invalidateQueries({ queryKey: ["playwright-jobs"] });
    },
  });

  const startExtraction = useCallback(
    (request: Partial<PlaywrightExtractionRequest>) => {
      return startExtractionMutation.mutateAsync(request);
    },
    [startExtractionMutation]
  );

  const startSinglePageExtraction = useCallback(
    (
      url: string,
      options?: {
        maxElements?: number;
        verifyExtractions?: boolean;
        verificationThreshold?: number;
        additionalBlockedKeywords?: string[];
      }
    ) => {
      return startSinglePageMutation.mutateAsync({ url, ...options });
    },
    [startSinglePageMutation]
  );

  const buildStates = useCallback(
    (
      jobId: string,
      options?: {
        stateNamePrefix?: string;
        verifiedOnly?: boolean;
        minConfidence?: number;
      }
    ) => {
      return buildStatesMutation.mutateAsync({ jobId, ...options });
    },
    [buildStatesMutation]
  );

  const deleteJob = useCallback(
    (jobId: string) => {
      return deleteJobMutation.mutateAsync(jobId);
    },
    [deleteJobMutation]
  );

  const clearCurrentJob = useCallback(() => {
    setCurrentJobId(null);
    setIsPolling(false);
  }, []);

  return {
    // Current job state
    currentJob,
    currentJobId,
    isLoadingJob,
    jobError,

    // Loading states
    isStarting:
      startExtractionMutation.isPending || startSinglePageMutation.isPending,
    isPolling,
    isBuildingStates: buildStatesMutation.isPending,
    isDeleting: deleteJobMutation.isPending,

    // Errors
    startError: startExtractionMutation.error || startSinglePageMutation.error,
    buildStatesError: buildStatesMutation.error,
    deleteError: deleteJobMutation.error,

    // Actions
    startExtraction,
    startSinglePageExtraction,
    buildStates,
    deleteJob,
    clearCurrentJob,
    refetchJob,
  };
}

/**
 * Hook to list all Playwright extraction jobs.
 */
export function usePlaywrightExtractionJobs(options?: {
  status?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["playwright-jobs", options],
    queryFn: () => playwrightExtractionService.listJobs(options),
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

/**
 * Hook to get a specific job by ID.
 */
export function usePlaywrightExtractionJob(jobId: string | null) {
  return useQuery({
    queryKey: ["playwright-extraction", jobId],
    queryFn: () =>
      jobId ? playwrightExtractionService.getJobStatus(jobId) : null,
    enabled: !!jobId,
  });
}

/**
 * Hook to persist and load Playwright extraction config from localStorage.
 */
export function usePlaywrightExtractionConfig() {
  const STORAGE_KEY = "qontinui_playwright_extraction_config";

  const [config, setConfig] = useState<{
    dangerousKeywords: string[];
    safeKeywords: string[];
    blockedSelectors: string[];
    maxRiskLevel: "safe" | "caution";
    dryRun: boolean;
    verifyExtractions: boolean;
    verificationThreshold: number;
  }>({
    dangerousKeywords: [],
    safeKeywords: [],
    blockedSelectors: [],
    maxRiskLevel: "safe",
    dryRun: true,
    verifyExtractions: true,
    verificationThreshold: 0.85,
  });

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setConfig(JSON.parse(stored));
      }
    } catch (e) {
      console.warn("Failed to load playwright extraction config:", e);
    }
  }, []);

  // Save to localStorage on change
  const saveConfig = useCallback((newConfig: typeof config) => {
    setConfig(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch (e) {
      console.warn("Failed to save playwright extraction config:", e);
    }
  }, []);

  const clearConfig = useCallback(() => {
    setConfig({
      dangerousKeywords: [],
      safeKeywords: [],
      blockedSelectors: [],
      maxRiskLevel: "safe",
      dryRun: true,
      verifyExtractions: true,
      verificationThreshold: 0.85,
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to clear playwright extraction config:", e);
    }
  }, []);

  return {
    config,
    setConfig: saveConfig,
    clearConfig,
  };
}
